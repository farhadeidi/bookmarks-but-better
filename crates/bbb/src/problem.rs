//! `application/problem+json` errors with stable machine-readable codes.
//!
//! Every failure the API can produce is one of these. The `code` is the part
//! clients branch on: it is a fixed string that never changes meaning, while
//! `detail` is human-facing prose that may be reworded freely. `status` is
//! repeated inside the body because a client that logs one response should not
//! have to correlate it with a header to know what happened.
//!
//! See [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457).

use core::fmt;

use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Serialize;

/// The media type every error response carries.
pub(crate) const PROBLEM_JSON: &str = "application/problem+json";

/// A stable, machine-readable failure classification.
///
/// Codes are part of the HTTP contract. Adding one is a compatible change;
/// renaming or repurposing one is not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProblemCode {
    /// The requested entry does not exist in the vault.
    NotFound,
    /// The route does not exist.
    RouteNotFound,
    /// The request body or a parameter is syntactically unusable.
    InvalidRequest,
    /// The supplied `revision` no longer matches the file on disk.
    StaleRevision,
    /// The target entry has an error-level diagnostic and must not be written.
    ReadOnly,
    /// A supplied value cannot be represented in the vault format.
    InvalidValue,
    /// The folder still has children and `recursive=true` was not given.
    FolderNotEmpty,
    /// More than one entry claims the requested identity.
    AmbiguousId,
    /// The move would place a folder inside itself.
    MoveIntoSelf,
    /// The `Host` header is missing or is not a loopback name.
    HostNotAllowed,
    /// The vault could not be read or written.
    VaultUnavailable,
}

impl ProblemCode {
    /// The stable wire representation.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::NotFound => "not_found",
            Self::RouteNotFound => "route_not_found",
            Self::InvalidRequest => "invalid_request",
            Self::StaleRevision => "stale_revision",
            Self::ReadOnly => "read_only",
            Self::InvalidValue => "invalid_value",
            Self::FolderNotEmpty => "folder_not_empty",
            Self::AmbiguousId => "ambiguous_id",
            Self::MoveIntoSelf => "move_into_self",
            Self::HostNotAllowed => "host_not_allowed",
            Self::VaultUnavailable => "vault_unavailable",
        }
    }

    /// The status this class of failure always uses.
    ///
    /// Status is a property of the code rather than of the call site, so the
    /// same failure can never be a 409 in one handler and a 422 in another.
    #[must_use]
    pub const fn status(self) -> StatusCode {
        match self {
            Self::NotFound | Self::RouteNotFound => StatusCode::NOT_FOUND,
            Self::InvalidRequest => StatusCode::BAD_REQUEST,
            Self::StaleRevision | Self::FolderNotEmpty | Self::AmbiguousId => StatusCode::CONFLICT,
            Self::ReadOnly | Self::InvalidValue | Self::MoveIntoSelf => {
                StatusCode::UNPROCESSABLE_ENTITY
            }
            Self::HostNotAllowed => StatusCode::FORBIDDEN,
            Self::VaultUnavailable => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    /// The short, fixed summary line.
    #[must_use]
    pub const fn title(self) -> &'static str {
        match self {
            Self::NotFound => "Not found",
            Self::RouteNotFound => "No such route",
            Self::InvalidRequest => "Invalid request",
            Self::StaleRevision => "Stale revision",
            Self::ReadOnly => "Entry is read-only",
            Self::InvalidValue => "Invalid value",
            Self::FolderNotEmpty => "Folder is not empty",
            Self::AmbiguousId => "Ambiguous identity",
            Self::MoveIntoSelf => "Cannot move a folder into itself",
            Self::HostNotAllowed => "Host not allowed",
            Self::VaultUnavailable => "Vault unavailable",
        }
    }
}

impl fmt::Display for ProblemCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// One rendered problem document.
#[derive(Debug, Clone)]
pub struct Problem {
    code: ProblemCode,
    detail: String,
}

impl Problem {
    /// Builds a problem with an explicit detail message.
    ///
    /// The detail must describe the *shape* of the failure, never the contents
    /// of a bookmark: these strings reach logs.
    #[must_use]
    pub fn new(code: ProblemCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }

    /// The classification.
    #[must_use]
    pub const fn code(&self) -> ProblemCode {
        self.code
    }

    /// The status this problem renders with.
    #[must_use]
    pub const fn status(&self) -> StatusCode {
        self.code.status()
    }

    /// The human-facing explanation.
    #[must_use]
    pub fn detail(&self) -> &str {
        &self.detail
    }
}

impl fmt::Display for Problem {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.detail)
    }
}

impl core::error::Error for Problem {}

#[derive(Debug, Serialize)]
struct ProblemBody<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    title: &'static str,
    status: u16,
    code: &'static str,
    detail: &'a str,
}

impl IntoResponse for Problem {
    fn into_response(self) -> Response {
        let status = self.status();
        let body = ProblemBody {
            kind: "about:blank",
            title: self.code.title(),
            status: status.as_u16(),
            code: self.code.as_str(),
            detail: &self.detail,
        };
        // Serialising a struct of strings and a `u16` cannot fail; falling back
        // to a hand-written document keeps the error path total anyway.
        let json = serde_json::to_string(&body).unwrap_or_else(|_| {
            r#"{"type":"about:blank","title":"Vault unavailable","status":500,"code":"vault_unavailable","detail":"the error could not be serialised"}"#
                .to_owned()
        });
        (status, [(header::CONTENT_TYPE, PROBLEM_JSON)], json).into_response()
    }
}
