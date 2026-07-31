//! The `Host` header guard.
//!
//! Binding to `127.0.0.1` stops other machines from connecting, but it does not
//! stop a web page the user is visiting from pointing a request at
//! `http://evil.example` when that name resolves to `127.0.0.1`. The browser
//! dials the loopback socket quite happily; only the `Host` header reveals that
//! the request was addressed to somebody else's name. Rejecting it is what
//! makes the loopback binding actually mean "only this machine's own clients" —
//! the standard DNS-rebinding defence.
//!
//! A request with no `Host` at all is refused too. Every HTTP/1.1 client sends
//! one, so its absence is not a case worth weakening the guard for.

use axum::extract::Request;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use std::net::IpAddr;

use crate::problem::{Problem, ProblemCode};

/// Rejects any request whose `Host` is not a loopback name.
pub(crate) async fn guard(request: Request, next: Next) -> Response {
    let host = request
        .headers()
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok());

    match host {
        Some(host) if is_loopback(host) => next.run(request).await,
        Some(_) => refuse("the Host header is not a loopback name").into_response(),
        None => refuse("the request has no Host header").into_response(),
    }
}

fn refuse(detail: &str) -> Problem {
    Problem::new(
        ProblemCode::HostNotAllowed,
        format!("{detail}; this daemon serves loopback clients only"),
    )
}

/// Whether `host` — a `Host` header value, so possibly with a port — names this
/// machine's loopback interface.
fn is_loopback(host: &str) -> bool {
    let name = strip_port(host);
    if name.eq_ignore_ascii_case("localhost") {
        return true;
    }
    let name = name
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
        .unwrap_or(name);
    // Every address in 127.0.0.0/8 and `::1` counts; anything that does not
    // parse as an address is a name we have no reason to trust.
    name.parse::<IpAddr>()
        .is_ok_and(|address| address.is_loopback())
}

/// Splits a `Host` value into its name, keeping IPv6 literals intact.
fn strip_port(host: &str) -> &str {
    if host.starts_with('[') {
        // `[::1]:52222` — the port separator is the colon after the bracket.
        return match host.find(']') {
            Some(end) => &host[..=end],
            None => host,
        };
    }
    match host.rsplit_once(':') {
        // A bare IPv6 literal has several colons and no port; leave it alone.
        Some((name, _)) if !name.contains(':') => name,
        _ => host,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_names_are_allowed() {
        for host in [
            "localhost",
            "localhost:52222",
            "LocalHost:8080",
            "127.0.0.1",
            "127.0.0.1:52222",
            // The guard has never cared which port a loopback name carries,
            // and it must not start: an installation explicitly configured on
            // the previous default stays reachable after an upgrade.
            "127.0.0.1:47321",
            "localhost:47321",
            "127.0.0.53",
            "[::1]",
            "[::1]:52222",
            "::1",
        ] {
            assert!(is_loopback(host), "{host} must be allowed");
        }
    }

    #[test]
    fn everything_else_is_refused() {
        for host in [
            "evil.example",
            "evil.example:52222",
            "bookmarks.local",
            "192.168.1.10:52222",
            "10.0.0.1",
            "[2001:db8::1]:52222",
            // A non-loopback name is refused whichever port it names, so
            // moving the default cannot have opened one of them up.
            "evil.example:47321",
            "192.168.1.10:47321",
            "",
        ] {
            assert!(!is_loopback(host), "{host} must be refused");
        }
    }
}
