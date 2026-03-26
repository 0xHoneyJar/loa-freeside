//! Shard management module
//!
//! Sprint S-4: Twilight Gateway Core
//! Implements shard pools per SDD §5.1.3

mod pool;
mod state;

pub use pool::ShardPool;
pub use state::ShardState;
