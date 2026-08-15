use std::env;

fn main() {
    println!("cargo:rerun-if-changed=assets/ielts-vocabulary.ico");

    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    let mut resource = winres::WindowsResource::new();
    resource.set_icon("assets/ielts-vocabulary.ico");
    resource.set("CompanyName", "IELTS Vocabulary");
    resource.set(
        "FileDescription",
        "Launches the IELTS Vocabulary local web service",
    );
    resource.set("InternalName", "IELTSVocabulary");
    resource.set("OriginalFilename", "IELTSVocabulary.exe");
    resource.set("ProductName", "IELTS Vocabulary");
    resource.set("ProductVersion", "0.1.0");

    resource
        .compile()
        .expect("failed to embed the IELTS Vocabulary Windows icon");
}
