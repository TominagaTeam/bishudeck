use std::{env, fs, path::PathBuf};

fn main() {
    generate_bundled_font_table();
    tauri_build::build()
}

/// Writes the `name -> bytes` table for `fonts/` that `src/fonts.rs` includes.
///
/// The files are baked into the binary rather than shipped as Tauri resources
/// so that serving one cannot fail at runtime: the `slides://` handler answers
/// from memory, with no path to resolve and no I/O error to report. The cost is
/// paid once, at link time.
///
/// Generated rather than hand-written because there are 140 of them — the
/// Japanese face alone is split into 124 `unicode-range` subsets, which is what
/// keeps a slide from pulling 6MB to draw one line of text. Adding a face is
/// then a matter of dropping the file in and naming it in `fonts.css`.
fn generate_bundled_font_table() {
    println!("cargo:rerun-if-changed=fonts");

    let dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("fonts");
    let mut names: Vec<String> = fs::read_dir(&dir)
        .expect("src-tauri/fonts must exist")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        // The licence texts and the README sit in the same directory but are
        // not served; only what `fonts.css` can reference goes in the table.
        .filter(|name| name.ends_with(".woff2") || name.ends_with(".css"))
        .collect();
    // `read_dir` order is whatever the filesystem says, and an order that moves
    // between machines would make the generated file — and the binary — differ
    // for no reason.
    names.sort();

    let mut out = String::from("pub static BUNDLED: &[(&str, &[u8])] = &[\n");
    for name in &names {
        // Forward slashes: `include_bytes!` takes them on every platform, while
        // a Windows backslash would read as an escape inside the literal.
        let path = dir.join(name).to_string_lossy().replace('\\', "/");
        out.push_str(&format!("    ({name:?}, include_bytes!({path:?})),\n"));
    }
    out.push_str("];\n");

    let target = PathBuf::from(env::var("OUT_DIR").unwrap()).join("bundled_fonts.rs");
    fs::write(target, out).expect("failed to write the bundled font table");
}
