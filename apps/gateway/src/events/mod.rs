//! Event handling module
//!
//! Provides event serialization and routing to message broker.

pub mod serialize;

pub use serialize::{GatewayEvent, InteractionEvent, serialize_event};
