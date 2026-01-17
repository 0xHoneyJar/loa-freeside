//! NATS JetStream integration
//!
//! Sprint S-4: Twilight Gateway Core
//! Publishes gateway events to NATS streams per SDD §7.1

mod publisher;

pub use publisher::NatsPublisher;
