//! A compact SHA-256 implementation used purely as a content fingerprint.
//!
//! The vault format needs a *stable* digest: identical bytes must produce an
//! identical revision on every platform and every release, forever. SHA-256 is
//! specified by FIPS 180-4 and gives that guarantee, and the implementation is
//! small enough that it is cheaper to own — and verify against the published
//! test vectors in [`tests`] — than to take a dependency tree for it.
//!
//! It is *not* used for any security decision. See [`crate::Revision`].

#[rustfmt::skip]
const K: [u32; 64] = [
    0x428a_2f98, 0x7137_4491, 0xb5c0_fbcf, 0xe9b5_dba5, 0x3956_c25b, 0x59f1_11f1,
    0x923f_82a4, 0xab1c_5ed5, 0xd807_aa98, 0x1283_5b01, 0x2431_85be, 0x550c_7dc3,
    0x72be_5d74, 0x80de_b1fe, 0x9bdc_06a7, 0xc19b_f174, 0xe49b_69c1, 0xefbe_4786,
    0x0fc1_9dc6, 0x240c_a1cc, 0x2de9_2c6f, 0x4a74_84aa, 0x5cb0_a9dc, 0x76f9_88da,
    0x983e_5152, 0xa831_c66d, 0xb003_27c8, 0xbf59_7fc7, 0xc6e0_0bf3, 0xd5a7_9147,
    0x06ca_6351, 0x1429_2967, 0x27b7_0a85, 0x2e1b_2138, 0x4d2c_6dfc, 0x5338_0d13,
    0x650a_7354, 0x766a_0abb, 0x81c2_c92e, 0x9272_2c85, 0xa2bf_e8a1, 0xa81a_664b,
    0xc24b_8b70, 0xc76c_51a3, 0xd192_e819, 0xd699_0624, 0xf40e_3585, 0x106a_a070,
    0x19a4_c116, 0x1e37_6c08, 0x2748_774c, 0x34b0_bcb5, 0x391c_0cb3, 0x4ed8_aa4a,
    0x5b9c_ca4f, 0x682e_6ff3, 0x748f_82ee, 0x78a5_636f, 0x84c8_7814, 0x8cc7_0208,
    0x90be_fffa, 0xa450_6ceb, 0xbef9_a3f7, 0xc671_78f2,
];

#[rustfmt::skip]
const INITIAL: [u32; 8] = [
    0x6a09_e667, 0xbb67_ae85, 0x3c6e_f372, 0xa54f_f53a,
    0x510e_527f, 0x9b05_688c, 0x1f83_d9ab, 0x5be0_cd19,
];

/// Computes the SHA-256 digest of `input`.
pub(crate) fn sha256(input: &[u8]) -> [u8; 32] {
    let mut state = INITIAL;

    let mut chunks = input.chunks_exact(64);
    for chunk in &mut chunks {
        let mut block = [0u8; 64];
        block.copy_from_slice(chunk);
        compress(&mut state, &block);
    }

    // Padding: 0x80, then zeroes, then the bit length as a big-endian u64.
    let remainder = chunks.remainder();
    let mut tail = [0u8; 128];
    tail[..remainder.len()].copy_from_slice(remainder);
    tail[remainder.len()] = 0x80;
    let tail_len = if remainder.len() < 56 { 64 } else { 128 };
    let bit_len = (input.len() as u64).wrapping_mul(8);
    tail[tail_len - 8..tail_len].copy_from_slice(&bit_len.to_be_bytes());

    for block in tail[..tail_len].chunks_exact(64) {
        let mut fixed = [0u8; 64];
        fixed.copy_from_slice(block);
        compress(&mut state, &fixed);
    }

    let mut digest = [0u8; 32];
    for (slot, word) in digest.chunks_exact_mut(4).zip(state) {
        slot.copy_from_slice(&word.to_be_bytes());
    }
    digest
}

/// Indices of the eight working variables the specification calls `a`..`h`.
/// They live in an array so a round can rotate them instead of copying each one
/// into the next.
const A: usize = 0;
const B: usize = 1;
const C: usize = 2;
const E: usize = 4;
const F: usize = 5;
const G: usize = 6;
const H: usize = 7;

fn compress(state: &mut [u32; 8], block: &[u8; 64]) {
    let mut schedule = [0u32; 64];
    for (index, slot) in schedule.iter_mut().take(16).enumerate() {
        let start = index * 4;
        *slot = u32::from_be_bytes([
            block[start],
            block[start + 1],
            block[start + 2],
            block[start + 3],
        ]);
    }
    for index in 16..64 {
        let s0 = schedule[index - 15].rotate_right(7)
            ^ schedule[index - 15].rotate_right(18)
            ^ (schedule[index - 15] >> 3);
        let s1 = schedule[index - 2].rotate_right(17)
            ^ schedule[index - 2].rotate_right(19)
            ^ (schedule[index - 2] >> 10);
        schedule[index] = schedule[index - 16]
            .wrapping_add(s0)
            .wrapping_add(schedule[index - 7])
            .wrapping_add(s1);
    }

    let mut working = *state;

    for index in 0..64 {
        let sum1 =
            working[E].rotate_right(6) ^ working[E].rotate_right(11) ^ working[E].rotate_right(25);
        let choose = (working[E] & working[F]) ^ ((!working[E]) & working[G]);
        let temp1 = working[H]
            .wrapping_add(sum1)
            .wrapping_add(choose)
            .wrapping_add(K[index])
            .wrapping_add(schedule[index]);
        let sum0 =
            working[A].rotate_right(2) ^ working[A].rotate_right(13) ^ working[A].rotate_right(22);
        let majority =
            (working[A] & working[B]) ^ (working[A] & working[C]) ^ (working[B] & working[C]);
        let temp2 = sum0.wrapping_add(majority);

        // h <- g, g <- f, … b <- a. After the rotation slot E holds the old d
        // and slot A holds the old h, which is exactly what the two assignments
        // below overwrite.
        working.rotate_right(1);
        working[E] = working[E].wrapping_add(temp1);
        working[A] = temp1.wrapping_add(temp2);
    }

    for (slot, value) in state.iter_mut().zip(working) {
        *slot = slot.wrapping_add(value);
    }
}

#[cfg(test)]
mod tests {
    use super::sha256;

    fn hex(input: &[u8]) -> String {
        use core::fmt::Write as _;
        sha256(input).iter().fold(String::new(), |mut out, byte| {
            let _ = write!(out, "{byte:02x}");
            out
        })
    }

    /// Test vectors published with FIPS 180-4 / NIST CAVP.
    #[test]
    fn matches_published_vectors() {
        assert_eq!(
            hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
        assert_eq!(
            hex(b"abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu"),
            "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1"
        );
        assert_eq!(
            hex(&vec![b'a'; 1_000_000]),
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
        );
    }

    /// Exercises every padding branch around the 55/56/63/64 byte boundaries.
    #[test]
    fn padding_boundaries_are_stable() {
        let expectations = [
            (
                55,
                "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318",
            ),
            (
                56,
                "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a",
            ),
            (
                63,
                "7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34",
            ),
            (
                64,
                "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb",
            ),
            (
                65,
                "635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0",
            ),
        ];
        for (length, expected) in expectations {
            assert_eq!(hex(&vec![b'a'; length]), expected, "length {length}");
        }
    }
}
