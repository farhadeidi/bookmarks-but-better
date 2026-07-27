//! Conformance validation of front matter, using a real YAML parser.
//!
//! [`crate::yaml`] deliberately understands only the small slice of YAML the
//! vault owns: it finds top-level keys and the byte ranges of single-line
//! scalars, and treats everything else as opaque bytes to be preserved. That is
//! the right design for *writing*, but on its own it would also mean the vault
//! happily hands out an entry whose unknown front matter no other tool can read.
//!
//! So every document is additionally handed to [`saphyr_parser`], an
//! independent conformant YAML parser, purely as a validator. Nothing it
//! produces is ever written back — all mutations still go through the byte-range
//! path — but if it cannot parse the front matter, or the front matter is
//! ambiguous, the document is refused and surfaced read-only.

use std::collections::HashSet;

use saphyr_parser::{Event, Parser};

/// Why front matter is not usable, even though the byte scanner could read the
/// keys the vault owns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum YamlProblem {
    /// The front matter is not valid YAML.
    Malformed { line: usize, detail: String },
    /// The front matter is valid YAML but its root is not a mapping.
    NonMapping { line: usize },
    /// A key appears more than once, so its value is ambiguous.
    ///
    /// YAML forbids duplicate keys; parsers that tolerate them disagree about
    /// which one wins, so a document containing one has no single meaning.
    DuplicateKey { key: String, line: usize },
    /// The front matter holds more than one YAML document.
    ///
    /// Reaching this through [`crate::BookmarkFile`] is difficult, because the
    /// byte scanner treats the first `---` line as the end of the block and
    /// refuses any other unindented line that is not `key: value`. It is kept
    /// as defence in depth: this module is the authority on what YAML means,
    /// and it should not depend on another module's framing to be correct.
    MultipleDocuments { line: usize },
}

/// What a node is doing in its enclosing container.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Role {
    Root,
    Key,
    Value,
    Element,
}

/// One open container while walking the event stream.
#[derive(Debug)]
struct Frame {
    mapping: bool,
    expecting_key: bool,
    keys: HashSet<String>,
}

/// Validates the YAML region of a document.
///
/// `region` is the text between the `---` delimiters, and `line_offset` is the
/// number of lines that precede it, so reported lines refer to the whole file.
pub(crate) fn validate(region: &str, line_offset: usize) -> Result<(), YamlProblem> {
    let mut stack: Vec<Frame> = Vec::new();
    let mut documents = 0usize;

    for result in Parser::new_from_str(region) {
        let (event, span) = result.map_err(|error| YamlProblem::Malformed {
            line: error.marker().line() + line_offset,
            detail: error.info().to_owned(),
        })?;
        let line = span.start.line() + line_offset;

        match event {
            Event::StreamStart | Event::StreamEnd | Event::Nothing | Event::DocumentEnd => {}
            Event::DocumentStart(_) => {
                documents += 1;
                if documents > 1 {
                    return Err(YamlProblem::MultipleDocuments { line });
                }
            }
            Event::Scalar(text, ..) => {
                let role = begin(&mut stack);
                if role == Role::Root {
                    return Err(YamlProblem::NonMapping { line });
                }
                if role == Role::Key {
                    remember_key(&mut stack, &text, line)?;
                }
                end(&mut stack);
            }
            Event::Alias(_) => {
                if begin(&mut stack) == Role::Root {
                    return Err(YamlProblem::NonMapping { line });
                }
                end(&mut stack);
            }
            Event::MappingStart(..) => {
                begin(&mut stack);
                stack.push(Frame {
                    mapping: true,
                    expecting_key: true,
                    keys: HashSet::new(),
                });
            }
            Event::SequenceStart(..) => {
                if begin(&mut stack) == Role::Root {
                    return Err(YamlProblem::NonMapping { line });
                }
                stack.push(Frame {
                    mapping: false,
                    expecting_key: false,
                    keys: HashSet::new(),
                });
            }
            Event::MappingEnd | Event::SequenceEnd => {
                stack.pop();
                end(&mut stack);
            }
        }
    }

    Ok(())
}

/// Returns what the node starting now is doing in its enclosing container.
fn begin(stack: &mut [Frame]) -> Role {
    match stack.last() {
        None => Role::Root,
        Some(frame) if !frame.mapping => Role::Element,
        Some(frame) if frame.expecting_key => Role::Key,
        Some(_) => Role::Value,
    }
}

/// Records that the node in progress has finished.
fn end(stack: &mut [Frame]) {
    if let Some(frame) = stack.last_mut().filter(|frame| frame.mapping) {
        frame.expecting_key = !frame.expecting_key;
    }
}

fn remember_key(stack: &mut [Frame], key: &str, line: usize) -> Result<(), YamlProblem> {
    let Some(frame) = stack.last_mut() else {
        return Ok(());
    };
    if frame.keys.insert(key.to_owned()) {
        Ok(())
    } else {
        Err(YamlProblem::DuplicateKey {
            key: key.to_owned(),
            line,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{YamlProblem, validate};

    fn check(region: &str) -> Result<(), YamlProblem> {
        validate(region, 1)
    }

    #[test]
    fn accepts_the_documents_the_vault_writes() {
        assert_eq!(
            check("bbb_id: a1b2c3d4\nbbb_title: React\ntags: [a, b]\n"),
            Ok(())
        );
        assert_eq!(check("# only a comment\n"), Ok(()));
        assert_eq!(check(""), Ok(()));
        assert_eq!(
            check("description: |\n  line one\n  line two\nnested:\n  a: 1\n  b:\n    - deep\n"),
            Ok(())
        );
        assert_eq!(check("منظمة: مرحبا\n'quoted key': 1\n"), Ok(()));
    }

    #[test]
    fn rejects_malformed_collections() {
        // An unterminated flow sequence, which the byte scanner would happily
        // pass over as an unknown key it does not touch.
        assert!(matches!(
            check("bbb_id: a1b2c3d4\ntags: [a, b\n"),
            Err(YamlProblem::Malformed { .. })
        ));
        assert!(matches!(
            check("bbb_id: a1b2c3d4\nmap: {a: 1\n"),
            Err(YamlProblem::Malformed { .. })
        ));
        assert!(matches!(
            check("bbb_id: a1b2c3d4\nbad: \"unterminated\n"),
            Err(YamlProblem::Malformed { .. })
        ));
        assert!(matches!(
            check("bbb_id: a1b2c3d4\nalias: *nowhere\n"),
            Err(YamlProblem::Malformed { .. })
        ));
        assert!(matches!(
            check("a: 1\n\ttabbed: 2\n"),
            Err(YamlProblem::Malformed { .. })
        ));
    }

    #[test]
    fn rejects_duplicate_keys_at_every_level() {
        assert_eq!(
            check("bbb_id: a1b2c3d4\ntags: one\ntags: two\n"),
            Err(YamlProblem::DuplicateKey {
                key: "tags".to_owned(),
                line: 4,
            })
        );
        assert!(matches!(
            check("outer:\n  inner: 1\n  inner: 2\n"),
            Err(YamlProblem::DuplicateKey { .. })
        ));
        // A repeated key inside a flow mapping is just as ambiguous.
        assert!(matches!(
            check("outer: {a: 1, a: 2}\n"),
            Err(YamlProblem::DuplicateKey { .. })
        ));
        // The same name in two different mappings is fine.
        assert_eq!(check("one:\n  name: a\ntwo:\n  name: b\n"), Ok(()));
    }

    #[test]
    fn rejects_roots_that_are_not_mappings() {
        assert!(matches!(
            check("- one\n- two\n"),
            Err(YamlProblem::NonMapping { .. })
        ));
        assert!(matches!(
            check("just a scalar\n"),
            Err(YamlProblem::NonMapping { .. })
        ));
        assert!(matches!(
            check("[a, b]\n"),
            Err(YamlProblem::NonMapping { .. })
        ));
    }

    #[test]
    fn rejects_more_than_one_document() {
        assert!(matches!(
            check("a: 1\n--- \nb: 2\n"),
            Err(YamlProblem::MultipleDocuments { .. })
        ));
    }

    #[test]
    fn reported_lines_are_absolute() {
        let problem = validate("a: 1\nb: 2\nb: 3\n", 1).expect_err("a duplicate");
        assert_eq!(
            problem,
            YamlProblem::DuplicateKey {
                key: "b".to_owned(),
                line: 4,
            }
        );
    }
}
