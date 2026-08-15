#![cfg_attr(windows, windows_subsystem = "windows")]

use std::env;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const DEFAULT_BIND: &str = "127.0.0.1:8770";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const POLL_INTERVAL: Duration = Duration::from_millis(200);
const CONNECT_TIMEOUT: Duration = Duration::from_millis(500);

fn main() {
    if let Err(message) = run() {
        show_error("IELTS Vocabulary", &message);
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let bind = env::var("IELTS_VOCAB_BIND").unwrap_or_else(|_| DEFAULT_BIND.to_owned());
    let listen_addr = bind
        .parse::<SocketAddr>()
        .map_err(|error| format!("Invalid IELTS_VOCAB_BIND value `{bind}`: {error}"))?;
    let health_addr = local_health_addr(listen_addr);
    let browser_url = format!("http://{}/", browser_authority(health_addr));

    // This also makes repeated clicks safe: if the service is already running,
    // the launcher only opens the application page.
    if service_is_ready(health_addr) {
        return open_browser(&browser_url);
    }

    let app_root = find_app_root().ok_or_else(|| {
        "Could not find the IELTS Vocabulary application files. Build the Windows package with `tools\\build_windows.ps1`, then run IELTSVocabulary.exe from its output folder.".to_owned()
    })?;
    let service_path = find_service(&app_root).ok_or_else(|| {
        format!(
            "The IELTS Vocabulary backend executable is missing. Expected it beside the launcher or under `{}`.",
            app_root.join("backend\\target\\release").display()
        )
    })?;

    let mut service = start_service(&app_root, &service_path, &bind)?;
    if let Err(message) = wait_for_service(&mut service, health_addr) {
        let _ = service.kill();
        return Err(message);
    }

    open_browser(&browser_url)
}

fn local_health_addr(listen_addr: SocketAddr) -> SocketAddr {
    let local_ip = match listen_addr.ip() {
        IpAddr::V4(ip) if ip.is_unspecified() => IpAddr::V4(Ipv4Addr::LOCALHOST),
        IpAddr::V6(ip) if ip.is_unspecified() => IpAddr::V6(std::net::Ipv6Addr::LOCALHOST),
        ip => ip,
    };
    SocketAddr::new(local_ip, listen_addr.port())
}

fn browser_authority(address: SocketAddr) -> String {
    match address {
        SocketAddr::V4(address) => address.to_string(),
        SocketAddr::V6(address) => format!("[{address}]"),
    }
}

fn service_is_ready(address: SocketAddr) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&address, CONNECT_TIMEOUT) else {
        return false;
    };

    let _ = stream.set_read_timeout(Some(CONNECT_TIMEOUT));
    let request = format!(
        "GET /health HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
        browser_authority(address)
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = [0_u8; 128];
    let Ok(length) = stream.read(&mut response) else {
        return false;
    };
    let response = String::from_utf8_lossy(&response[..length]);
    response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")
}

fn find_app_root() -> Option<PathBuf> {
    let executable = env::current_exe().ok()?;
    let mut candidate = executable.parent()?.to_path_buf();

    loop {
        if is_app_root(&candidate) {
            return Some(candidate);
        }
        if !candidate.pop() {
            return None;
        }
    }
}

fn is_app_root(root: &Path) -> bool {
    root.join("frontend\\dist\\index.html").is_file() && find_service(root).is_some()
}

fn find_service(root: &Path) -> Option<PathBuf> {
    [
        root.join("ielts-vocabulary-service.exe"),
        root.join("backend\\target\\release\\ielts-vocabulary-service.exe"),
        root.join("backend\\target\\debug\\ielts-vocabulary-service.exe"),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

fn start_service(root: &Path, service_path: &Path, bind: &str) -> Result<Child, String> {
    let content_root = root.join("var\\content");
    let export_root = content_root.join("exports");
    fs::create_dir_all(&export_root).map_err(|error| {
        format!(
            "Could not create the runtime export directory `{}`: {error}",
            export_root.display()
        )
    })?;

    let log_path = root.join("var\\ielts-vocabulary-service.log");
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| {
            format!(
                "Could not open the service log `{}`: {error}",
                log_path.display()
            )
        })?;
    let log_copy = log
        .try_clone()
        .map_err(|error| format!("Could not prepare the service log: {error}"))?;

    let mut command = Command::new(service_path);
    command
        .current_dir(root)
        .env("IELTS_VOCAB_BIND", bind)
        .env(
            "IELTS_VOCAB_CONTENT_DB",
            content_root.join("content.sqlite"),
        )
        .env("IELTS_VOCAB_MEDIA_ROOT", content_root.join("media"))
        .env("IELTS_VOCAB_FRONTEND_ROOT", root.join("frontend\\dist"))
        .env("IELTS_VOCAB_EXPORT_ROOT", export_root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_copy));

    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW

    command.spawn().map_err(|error| {
        format!(
            "Could not start the IELTS Vocabulary backend `{}`: {error}",
            service_path.display()
        )
    })
}

fn wait_for_service(service: &mut Child, address: SocketAddr) -> Result<(), String> {
    let started_at = Instant::now();

    loop {
        if service_is_ready(address) {
            return Ok(());
        }

        if let Some(status) = service
            .try_wait()
            .map_err(|error| format!("Could not inspect the backend process: {error}"))?
        {
            if service_is_ready(address) {
                return Ok(());
            }
            return Err(format!(
                "The IELTS Vocabulary backend stopped before it became ready (exit status {status}). Check `var\\ielts-vocabulary-service.log` for details."
            ));
        }

        if started_at.elapsed() >= STARTUP_TIMEOUT {
            return Err(
                "The IELTS Vocabulary backend did not become ready within 30 seconds. Check `var\\ielts-vocabulary-service.log` for details.".to_owned(),
            );
        }

        thread::sleep(POLL_INTERVAL);
    }
}

fn open_browser(url: &str) -> Result<(), String> {
    let mut command = Command::new("cmd");
    command.args(["/C", "start", "", url]);

    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open the browser at {url}: {error}"))
}

#[cfg(windows)]
fn show_error(title: &str, message: &str) {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn MessageBoxW(
            window: *mut std::ffi::c_void,
            text: *const u16,
            caption: *const u16,
            kind: u32,
        ) -> i32;
    }

    let text: Vec<u16> = std::ffi::OsStr::new(message)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let caption: Vec<u16> = std::ffi::OsStr::new(title)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            caption.as_ptr(),
            0x0000_0010, // MB_ICONERROR
        );
    }
}

#[cfg(not(windows))]
fn show_error(title: &str, message: &str) {
    eprintln!("{title}: {message}");
}
