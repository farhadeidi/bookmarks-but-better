//! Extractors that fail the way the rest of the API fails.
//!
//! Axum's built-in `Json` and `Query` rejections render as `text/plain`. A
//! client that has to parse two error formats — one for the handlers and one
//! for the extractors that never reached them — will get one of them wrong. So
//! both are wrapped here to produce `application/problem+json` with the same
//! codes as everything else.

use axum::extract::rejection::{JsonRejection, QueryRejection};
use axum::extract::{FromRequest, FromRequestParts, Query, Request};
use axum::http::request::Parts;
use serde::de::DeserializeOwned;

use crate::problem::{Problem, ProblemCode};

/// A JSON body that rejects with a problem document.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ApiJson<T>(pub(crate) T);

impl<T, S> FromRequest<S> for ApiJson<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = Problem;

    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        axum::Json::<T>::from_request(request, state)
            .await
            .map(|axum::Json(value)| Self(value))
            .map_err(|rejection| {
                // The body reached us but did not fit the contract; that is a
                // malformed request, not a vault problem.
                let detail = match &rejection {
                    JsonRejection::JsonDataError(error) => error.body_text(),
                    JsonRejection::JsonSyntaxError(error) => error.body_text(),
                    JsonRejection::MissingJsonContentType(_) => {
                        "the request body must be sent as application/json".to_owned()
                    }
                    _ => "the request body could not be read".to_owned(),
                };
                Problem::new(ProblemCode::InvalidRequest, detail)
            })
    }
}

/// A query string that rejects with a problem document.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ApiQuery<T>(pub(crate) T);

impl<T, S> FromRequestParts<S> for ApiQuery<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = Problem;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        Query::<T>::from_request_parts(parts, state)
            .await
            .map(|Query(value)| Self(value))
            .map_err(|rejection| {
                let detail = match &rejection {
                    QueryRejection::FailedToDeserializeQueryString(error) => error.body_text(),
                    _ => "the query string could not be read".to_owned(),
                };
                Problem::new(ProblemCode::InvalidRequest, detail)
            })
    }
}
