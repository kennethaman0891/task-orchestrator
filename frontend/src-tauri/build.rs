fn main() {
    // Rebuild when the frontend dist changes (embedded UI)
    println!("cargo:rerun-if-changed=../dist");
    println!("cargo:rerun-if-changed=../dist/assets");
    // Rebuild when bundled backend source changes (sidecar binary picks up new code)
    println!("cargo:rerun-if-changed=resources/backend");
    println!("cargo:rerun-if-changed=resources/downloads.html");
    tauri_build::build()
}
