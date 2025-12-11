use libdeflater::Decompressor;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn inflate_zlib(input: &[u8]) -> Result<Vec<u8>, JsError> {
    let mut decompressor = Decompressor::new();
    let mut size = input.len() * 4;

    loop {
        let mut output = vec![0u8; size];
        match decompressor.zlib_decompress(input, &mut output) {
            Ok(actual_size) => {
                output.truncate(actual_size);
                return Ok(output);
            }
            Err(libdeflater::DecompressionError::InsufficientSpace) => {
                size *= 2;
                if size > 256 * 1024 * 1024 {
                    return Err(JsError::new("decompression output too large"));
                }
            }
            Err(e) => {
                return Err(JsError::new(&format!("zlib decompression failed: {:?}", e)));
            }
        }
    }
}

#[wasm_bindgen]
pub fn inflate_gzip(input: &[u8]) -> Result<Vec<u8>, JsError> {
    let mut decompressor = Decompressor::new();
    let mut size = input.len() * 4;

    loop {
        let mut output = vec![0u8; size];
        match decompressor.gzip_decompress(input, &mut output) {
            Ok(actual_size) => {
                output.truncate(actual_size);
                return Ok(output);
            }
            Err(libdeflater::DecompressionError::InsufficientSpace) => {
                size *= 2;
                if size > 256 * 1024 * 1024 {
                    return Err(JsError::new("decompression output too large"));
                }
            }
            Err(e) => {
                return Err(JsError::new(&format!("gzip decompression failed: {:?}", e)));
            }
        }
    }
}

#[wasm_bindgen]
pub fn inflate(input: &[u8]) -> Result<Vec<u8>, JsError> {
    if input.len() < 2 {
        return Err(JsError::new("input too short"));
    }

    if input[0] == 0x1f && input[1] == 0x8b {
        inflate_gzip(input)
    } else {
        inflate_zlib(input)
    }
}
