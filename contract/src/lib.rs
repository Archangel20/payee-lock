//! Payee Lock — an open registry of receiving addresses.
//!
//! A NEAR account registers the addresses where it wants to be paid on each
//! chain. The first set is active immediately. Every later change is public
//! and inert until a delay elapses. Until that moment the previous address
//! stays the one `verify` accepts. The payee, or a guardian the payee cannot
//! remove, can veto during the window.
//!
//! The delay floor is chosen when the contract is initialized. A production
//! deployment should use 72 hours. This demo deployment uses a short floor so
//! the window is visible.

use near_sdk::store::LookupMap;
use near_sdk::{env, log, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault};

pub const RECOMMENDED_DELAY_SECONDS: u64 = 72 * 60 * 60;
const MAX_DELAY_SECONDS: u64 = 30 * 24 * 60 * 60;
const MAX_ACTIVITY: usize = 100;
const MAX_NAME_LEN: usize = 64;
/// Attached on `register` so the contract account can cover the new state.
const STORAGE_DEPOSIT_YOCTO: u128 = 20_000_000_000_000_000_000_000;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Payees,
    Addresses,
}

#[near(serializers = [borsh])]
pub struct PayeeMeta {
    display_name: String,
    guardian: Option<AccountId>,
    delay_ns: u64,
    chains: Vec<String>,
}

#[near(serializers = [borsh])]
pub struct PendingChange {
    proposed: String,
    proposed_by: AccountId,
    proposed_at_ms: u64,
    activates_at_ms: u64,
}

#[near(serializers = [borsh])]
pub struct AddressSlot {
    current: Option<String>,
    pending: Option<PendingChange>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    min_delay_ns: u64,
    payees: LookupMap<AccountId, PayeeMeta>,
    payee_ids: Vec<AccountId>,
    addresses: LookupMap<String, AddressSlot>,
    activity: Vec<ActivityEvent>,
    next_event_id: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct ActivityEvent {
    pub id: u64,
    pub kind: String,
    pub payee: String,
    pub chain: Option<String>,
    pub address: Option<String>,
    pub actor: String,
    pub at_ms: u64,
    pub activates_at_ms: Option<u64>,
}

#[near(serializers = [json])]
pub struct ChainAddress {
    pub chain: String,
    pub address: String,
}

#[near(serializers = [json])]
pub struct ConfigView {
    pub min_delay_seconds: u64,
    pub recommended_delay_seconds: u64,
    pub payee_count: u64,
    pub standard: String,
    pub version: String,
}

#[near(serializers = [json])]
pub struct AddressView {
    pub chain: String,
    pub current: Option<String>,
    pub pending: Option<String>,
    pub proposed_by: Option<String>,
    pub proposed_at_ms: Option<u64>,
    pub activates_at_ms: Option<u64>,
    /// True when the delay has elapsed but `settle` has not written it yet.
    /// `current` already reflects the new address in that case.
    pub needs_settle: bool,
}

#[near(serializers = [json])]
pub struct PayeeView {
    pub account_id: String,
    pub display_name: String,
    pub guardian: Option<String>,
    pub delay_seconds: u64,
    pub addresses: Vec<AddressView>,
}

#[near(serializers = [json])]
pub struct VerifyResult {
    /// `match`, `no_match`, `pending_change`, or `not_registered`.
    pub status: String,
    pub payee: String,
    pub chain: String,
    pub queried: String,
    pub current: Option<String>,
    pub pending: Option<String>,
    pub activates_at_ms: Option<u64>,
    pub display_name: Option<String>,
}

#[near]
impl Contract {
    #[init]
    pub fn init(min_delay_seconds: u64) -> Self {
        require!(
            (1..=MAX_DELAY_SECONDS).contains(&min_delay_seconds),
            "min_delay_seconds must be between 1 and 30 days"
        );
        Self {
            min_delay_ns: seconds_to_ns(min_delay_seconds),
            payees: LookupMap::new(StorageKey::Payees),
            payee_ids: Vec::new(),
            addresses: LookupMap::new(StorageKey::Addresses),
            activity: Vec::new(),
            next_event_id: 1,
        }
    }

    /// The predecessor account becomes the payee. Initial addresses are active
    /// immediately because nothing was relying on a previous value.
    #[payable]
    pub fn register(
        &mut self,
        display_name: String,
        guardian: Option<AccountId>,
        delay_seconds: u64,
        addresses: Vec<ChainAddress>,
    ) {
        require!(
            env::attached_deposit() >= NearToken::from_yoctonear(STORAGE_DEPOSIT_YOCTO),
            "attach at least 0.02 NEAR to cover storage"
        );
        let payee = env::predecessor_account_id();
        require!(
            self.payees.get(&payee).is_none(),
            "payee is already registered"
        );
        let display_name = clean_name(&display_name);
        let delay_ns = self.checked_delay(delay_seconds);
        require!(!addresses.is_empty(), "register at least one chain address");
        require!(
            addresses.len() <= 16,
            "at most 16 addresses can be registered at once"
        );

        let mut chains = Vec::with_capacity(addresses.len());
        let mut normalized = Vec::with_capacity(addresses.len());
        for entry in addresses {
            let chain = canonical_chain(&entry.chain);
            let address = normalize_address(&chain, &entry.address);
            require!(
                !chains.iter().any(|existing: &String| existing == &chain),
                "duplicate chain in register"
            );
            chains.push(chain);
            normalized.push(address);
        }

        self.payees.insert(
            payee.clone(),
            PayeeMeta {
                display_name: display_name.clone(),
                guardian,
                delay_ns,
                chains: chains.clone(),
            },
        );
        self.payee_ids.push(payee.clone());

        for (chain, address) in chains.iter().zip(normalized.iter()) {
            self.addresses.insert(
                slot_key(&payee, chain),
                AddressSlot {
                    current: Some(address.clone()),
                    pending: None,
                },
            );
        }

        self.push_event("payee_registered", &payee, None, None, None);
        log!(
            "registered {} ({}) on {}",
            payee,
            display_name,
            chains.join(",")
        );
    }

    /// Ask to replace (or add) the address for `chain`. Only the payee account
    /// can do this. The current address stays authoritative until the delay
    /// passes. A pending change must be vetoed or settled before another one.
    pub fn propose_address(&mut self, chain: String, new_address: String) {
        let payee = env::predecessor_account_id();
        let chain = canonical_chain(&chain);
        let new_address = normalize_address(&chain, &new_address);
        self.settle_if_due(&payee, &chain);

        let meta = self
            .payees
            .get(&payee)
            .unwrap_or_else(|| env::panic_str("payee is not registered"))
            .clone_meta();
        let key = slot_key(&payee, &chain);
        let slot = self.addresses.get(&key);
        if let Some(slot) = slot {
            require!(
                slot.pending.is_none(),
                "a change is already pending; veto it or wait for it to activate"
            );
            if slot.current.as_deref() == Some(new_address.as_str()) {
                env::panic_str("proposed address matches the current address");
            }
        }

        let now = now_ms();
        let activates_at_ms = now + ns_to_ms(meta.delay_ns);
        let pending = PendingChange {
            proposed: new_address.clone(),
            proposed_by: payee.clone(),
            proposed_at_ms: now,
            activates_at_ms,
        };

        if let Some(mut slot) = self.addresses.get(&key).map(clone_slot) {
            slot.pending = Some(pending);
            self.addresses.insert(key, slot);
        } else {
            let mut meta_mut = self
                .payees
                .get(&payee)
                .unwrap_or_else(|| env::panic_str("payee is not registered"))
                .clone_meta();
            meta_mut.chains.push(chain.clone());
            self.payees.insert(payee.clone(), meta_mut);
            self.addresses.insert(
                key,
                AddressSlot {
                    current: None,
                    pending: Some(pending),
                },
            );
        }

        self.push_event(
            "address_proposed",
            &payee,
            Some(&chain),
            Some(&new_address),
            Some(activates_at_ms),
        );
    }

    /// Cancel a pending change. The payee and the guardian may both call this.
    /// Once the delay has elapsed the change is already effective and cannot
    /// be vetoed.
    pub fn veto(&mut self, payee: AccountId, chain: String) {
        let chain = canonical_chain(&chain);
        self.assert_owner_or_guardian(&payee);
        // If the window has already closed, settle and refuse the veto.
        if self.settle_if_due(&payee, &chain) {
            env::panic_str("the delay has elapsed and the change is already effective");
        }
        let key = slot_key(&payee, &chain);
        let Some(mut slot) = self.addresses.get(&key).map(clone_slot) else {
            env::panic_str("no address is registered for that chain");
        };
        let pending = slot
            .pending
            .take()
            .unwrap_or_else(|| env::panic_str("no change is pending"));
        self.addresses.insert(key, slot);
        self.push_event(
            "address_vetoed",
            &payee,
            Some(&chain),
            Some(&pending.proposed),
            None,
        );
    }

    /// Persist a change whose delay has elapsed. Anyone can call this.
    /// Returns true when an address was promoted.
    pub fn settle(&mut self, payee: AccountId, chain: String) -> bool {
        let chain = canonical_chain(&chain);
        require!(self.payees.get(&payee).is_some(), "payee is not registered");
        self.settle_if_due(&payee, &chain)
    }

    /// Set a guardian while there is none (payee only), or rotate the guardian
    /// (current guardian only). The payee cannot remove or replace a guardian.
    /// There is no clear. That is the point: a stolen payee key must not be
    /// able to dismiss the veto.
    pub fn set_guardian(&mut self, payee: AccountId, guardian: AccountId) {
        require!(guardian != payee, "guardian must be a different account");
        let caller = env::predecessor_account_id();
        let Some(mut meta) = self.payees.get(&payee).map(|m| m.clone_meta()) else {
            env::panic_str("payee is not registered");
        };
        match &meta.guardian {
            None => {
                require!(
                    caller == payee,
                    "only the payee can appoint the first guardian"
                );
            }
            Some(current) => {
                require!(
                    caller == *current,
                    "only the current guardian can rotate the guardian"
                );
                require!(
                    guardian != *current,
                    "new guardian matches the current guardian"
                );
            }
        }
        meta.guardian = Some(guardian.clone());
        self.payees.insert(payee.clone(), meta);
        self.push_event("guardian_set", &payee, None, Some(guardian.as_str()), None);
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            min_delay_seconds: ns_to_seconds(self.min_delay_ns),
            recommended_delay_seconds: RECOMMENDED_DELAY_SECONDS,
            payee_count: self.payee_ids.len() as u64,
            standard: "payee-lock".to_string(),
            version: "1.0.0".to_string(),
        }
    }

    pub fn get_payee(&self, payee: AccountId) -> Option<PayeeView> {
        let meta = self.payees.get(&payee)?;
        Some(self.view_of(&payee, meta))
    }

    pub fn get_payees(&self) -> Vec<PayeeView> {
        self.payee_ids
            .iter()
            .filter_map(|id| self.get_payee(id.clone()))
            .collect()
    }

    pub fn find_payee(&self, name: String) -> Vec<PayeeView> {
        let needle = name.trim().to_lowercase();
        if needle.is_empty() {
            return Vec::new();
        }
        self.get_payees()
            .into_iter()
            .filter(|payee| {
                payee.display_name.to_lowercase() == needle
                    || payee.account_id.to_lowercase() == needle
                    || payee
                        .account_id
                        .split('.')
                        .next()
                        .unwrap_or("")
                        .eq_ignore_ascii_case(&needle)
            })
            .collect()
    }

    /// `match` — this is the address that should be paid right now.
    /// `pending_change` — this address has been proposed and is not payable yet.
    /// `no_match` — the payee exists, and this is not an address it accepts.
    /// `not_registered` — that NEAR account has no payee record.
    pub fn verify(&self, payee: AccountId, chain: String, address: String) -> VerifyResult {
        let Some(meta) = self.payees.get(&payee) else {
            return VerifyResult {
                status: "not_registered".to_string(),
                payee: payee.to_string(),
                chain: chain.trim().to_ascii_lowercase(),
                queried: address,
                current: None,
                pending: None,
                activates_at_ms: None,
                display_name: None,
            };
        };
        let chain = match try_canonical_chain(&chain) {
            Some(chain) => chain,
            None => {
                return VerifyResult {
                    status: "no_match".to_string(),
                    payee: payee.to_string(),
                    chain: chain.trim().to_ascii_lowercase(),
                    queried: address,
                    current: None,
                    pending: None,
                    activates_at_ms: None,
                    display_name: Some(meta.display_name.clone()),
                };
            }
        };
        let queried = match try_normalize_address(&chain, &address) {
            Some(value) => value,
            None => {
                return self.negative(
                    &payee,
                    &meta.display_name,
                    &chain,
                    &address,
                    self.addresses.get(&slot_key(&payee, &chain)),
                );
            }
        };
        let slot = self.addresses.get(&slot_key(&payee, &chain));
        let (current, pending) = effective(slot, now_ms());
        let status = if current.as_deref() == Some(queried.as_str()) {
            "match"
        } else if pending
            .as_ref()
            .is_some_and(|item| item.proposed == queried)
        {
            "pending_change"
        } else {
            "no_match"
        };
        VerifyResult {
            status: status.to_string(),
            payee: payee.to_string(),
            chain,
            queried,
            current,
            pending: pending.as_ref().map(|item| item.proposed.clone()),
            activates_at_ms: pending.as_ref().map(|item| item.activates_at_ms),
            display_name: Some(meta.display_name.clone()),
        }
    }

    pub fn get_activity(&self, payee: Option<AccountId>, limit: Option<u32>) -> Vec<ActivityEvent> {
        let limit = limit.unwrap_or(50).clamp(1, 100) as usize;
        let filter = payee.map(|id| id.to_string());
        self.activity
            .iter()
            .rev()
            .filter(|event| filter.as_ref().is_none_or(|id| &event.payee == id))
            .take(limit)
            .cloned()
            .collect()
    }
}

impl Contract {
    fn checked_delay(&self, delay_seconds: u64) -> u64 {
        let delay_ns = seconds_to_ns(delay_seconds);
        require!(
            delay_ns >= self.min_delay_ns,
            "delay is shorter than this contract's minimum"
        );
        require!(
            delay_seconds <= MAX_DELAY_SECONDS,
            "delay cannot exceed 30 days"
        );
        delay_ns
    }

    fn assert_owner_or_guardian(&self, payee: &AccountId) {
        let caller = env::predecessor_account_id();
        let meta = self
            .payees
            .get(payee)
            .unwrap_or_else(|| env::panic_str("payee is not registered"));
        let guardian_ok = meta
            .guardian
            .as_ref()
            .is_some_and(|guardian| guardian == &caller);
        require!(
            caller == *payee || guardian_ok,
            "only the payee or the guardian can veto"
        );
    }

    /// Promote a due proposal. Returns true when the slot changed.
    fn settle_if_due(&mut self, payee: &AccountId, chain: &str) -> bool {
        let key = slot_key(payee, chain);
        let Some(slot) = self.addresses.get(&key).map(clone_slot) else {
            return false;
        };
        let Some(pending) = slot.pending else {
            return false;
        };
        if now_ms() < pending.activates_at_ms {
            return false;
        }
        let activated = pending.proposed.clone();
        self.addresses.insert(
            key,
            AddressSlot {
                current: Some(activated.clone()),
                pending: None,
            },
        );
        self.push_event(
            "address_activated",
            payee,
            Some(chain),
            Some(&activated),
            None,
        );
        true
    }

    fn view_of(&self, payee: &AccountId, meta: &PayeeMeta) -> PayeeView {
        let now = now_ms();
        let addresses = meta
            .chains
            .iter()
            .map(|chain| {
                let slot = self.addresses.get(&slot_key(payee, chain));
                let needs_settle = slot
                    .and_then(|item| item.pending.as_ref())
                    .is_some_and(|pending| now >= pending.activates_at_ms);
                let (current, pending) = effective(slot, now);
                AddressView {
                    chain: chain.clone(),
                    current,
                    pending: pending.as_ref().map(|item| item.proposed.clone()),
                    proposed_by: pending.as_ref().map(|item| item.proposed_by.to_string()),
                    proposed_at_ms: pending.as_ref().map(|item| item.proposed_at_ms),
                    activates_at_ms: pending.as_ref().map(|item| item.activates_at_ms),
                    needs_settle,
                }
            })
            .collect();
        PayeeView {
            account_id: payee.to_string(),
            display_name: meta.display_name.clone(),
            guardian: meta.guardian.as_ref().map(|id| id.to_string()),
            delay_seconds: ns_to_seconds(meta.delay_ns),
            addresses,
        }
    }

    fn negative(
        &self,
        payee: &AccountId,
        display_name: &str,
        chain: &str,
        queried: &str,
        slot: Option<&AddressSlot>,
    ) -> VerifyResult {
        let (current, pending) = effective(slot, now_ms());
        VerifyResult {
            status: "no_match".to_string(),
            payee: payee.to_string(),
            chain: chain.to_string(),
            queried: queried.to_string(),
            current,
            pending: pending.as_ref().map(|item| item.proposed.clone()),
            activates_at_ms: pending.as_ref().map(|item| item.activates_at_ms),
            display_name: Some(display_name.to_string()),
        }
    }

    fn push_event(
        &mut self,
        kind: &str,
        payee: &AccountId,
        chain: Option<&str>,
        address: Option<&str>,
        activates_at_ms: Option<u64>,
    ) {
        let actor = env::predecessor_account_id();
        let event = ActivityEvent {
            id: self.next_event_id,
            kind: kind.to_string(),
            payee: payee.to_string(),
            chain: chain.map(str::to_string),
            address: address.map(str::to_string),
            actor: actor.to_string(),
            at_ms: now_ms(),
            activates_at_ms,
        };
        self.next_event_id += 1;
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({
                "standard": "payee-lock",
                "version": "1.0.0",
                "event": kind,
                "data": [{
                    "payee": event.payee,
                    "chain": event.chain,
                    "address": event.address,
                    "actor": event.actor,
                    "at_ms": event.at_ms,
                    "activates_at_ms": event.activates_at_ms,
                }]
            })
        ));
        self.activity.push(event);
        if self.activity.len() > MAX_ACTIVITY {
            let overflow = self.activity.len() - MAX_ACTIVITY;
            self.activity.drain(0..overflow);
        }
    }
}

impl PayeeMeta {
    fn clone_meta(&self) -> Self {
        Self {
            display_name: self.display_name.clone(),
            guardian: self.guardian.clone(),
            delay_ns: self.delay_ns,
            chains: self.chains.clone(),
        }
    }
}

fn clone_slot(slot: &AddressSlot) -> AddressSlot {
    AddressSlot {
        current: slot.current.clone(),
        pending: slot.pending.as_ref().map(|pending| PendingChange {
            proposed: pending.proposed.clone(),
            proposed_by: pending.proposed_by.clone(),
            proposed_at_ms: pending.proposed_at_ms,
            activates_at_ms: pending.activates_at_ms,
        }),
    }
}

/// What `verify` should treat as true at `now_ms`, including a change whose
/// delay has elapsed but that nobody has settled yet.
fn effective(slot: Option<&AddressSlot>, now_ms: u64) -> (Option<String>, Option<PendingChange>) {
    let Some(slot) = slot else {
        return (None, None);
    };
    if let Some(pending) = &slot.pending {
        if now_ms >= pending.activates_at_ms {
            return (Some(pending.proposed.clone()), None);
        }
        return (slot.current.clone(), Some(clone_pending(pending)));
    }
    (slot.current.clone(), None)
}

fn clone_pending(pending: &PendingChange) -> PendingChange {
    PendingChange {
        proposed: pending.proposed.clone(),
        proposed_by: pending.proposed_by.clone(),
        proposed_at_ms: pending.proposed_at_ms,
        activates_at_ms: pending.activates_at_ms,
    }
}

fn slot_key(payee: &AccountId, chain: &str) -> String {
    format!("{payee}:{chain}")
}

fn now_ms() -> u64 {
    env::block_timestamp() / 1_000_000
}

fn ns_to_ms(ns: u64) -> u64 {
    ns / 1_000_000
}

fn ns_to_seconds(ns: u64) -> u64 {
    ns / 1_000_000_000
}

fn seconds_to_ns(seconds: u64) -> u64 {
    seconds
        .checked_mul(1_000_000_000)
        .unwrap_or_else(|| env::panic_str("delay overflow"))
}

fn clean_name(name: &str) -> String {
    let trimmed = name.trim();
    require!(
        (2..=MAX_NAME_LEN).contains(&trimmed.len()),
        "display name must be 2 to 64 characters"
    );
    require!(
        trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, ' ' | '.' | '-' | '&' | '\'')),
        "display name has unsupported characters"
    );
    trimmed.to_string()
}

fn canonical_chain(input: &str) -> String {
    try_canonical_chain(input).unwrap_or_else(|| env::panic_str("unsupported chain"))
}

fn try_canonical_chain(input: &str) -> Option<String> {
    Some(
        match input.trim().to_ascii_lowercase().as_str() {
            "near" => "near",
            "ethereum" | "eth" | "evm" => "ethereum",
            "base" => "base",
            "arbitrum" | "arb" => "arbitrum",
            "polygon" | "matic" => "polygon",
            "solana" | "sol" => "solana",
            "bitcoin" | "btc" => "bitcoin",
            _ => return None,
        }
        .to_string(),
    )
}

fn is_evm(chain: &str) -> bool {
    matches!(chain, "ethereum" | "base" | "arbitrum" | "polygon")
}

fn normalize_address(chain: &str, address: &str) -> String {
    try_normalize_address(chain, address)
        .unwrap_or_else(|| env::panic_str("address is not valid for that chain"))
}

fn try_normalize_address(chain: &str, address: &str) -> Option<String> {
    let trimmed = address.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return None;
    }
    if is_evm(chain) {
        return normalize_evm(trimmed);
    }
    match chain {
        "near" => normalize_near(trimmed),
        "solana" => normalize_solana(trimmed),
        "bitcoin" => normalize_bitcoin(trimmed),
        _ => None,
    }
}

fn normalize_evm(address: &str) -> Option<String> {
    let lower = address.to_ascii_lowercase();
    if lower.len() == 42
        && lower.starts_with("0x")
        && lower[2..].bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        Some(lower)
    } else {
        None
    }
}

fn normalize_near(address: &str) -> Option<String> {
    let lower = address.to_ascii_lowercase();
    if lower.len() == 64 && lower.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Some(lower);
    }
    if !(2..=64).contains(&lower.len()) {
        return None;
    }
    let ok = lower.split('.').all(|part| {
        !part.is_empty()
            && part.len() <= 64
            && !part.starts_with('-')
            && !part.starts_with('_')
            && !part.ends_with('-')
            && !part.ends_with('_')
            && part.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-' || byte == b'_'
            })
    });
    if ok {
        Some(lower)
    } else {
        None
    }
}

fn base58_bytes(address: &str) -> bool {
    !address.is_empty()
        && address.bytes().all(|byte| {
            matches!(byte,
                b'1'..=b'9' | b'A'..=b'H' | b'J'..=b'N' | b'P'..=b'Z' | b'a'..=b'k' | b'm'..=b'z'
            )
        })
}

fn normalize_solana(address: &str) -> Option<String> {
    if (32..=44).contains(&address.len()) && base58_bytes(address) {
        Some(address.to_string())
    } else {
        None
    }
}

fn normalize_bitcoin(address: &str) -> Option<String> {
    let lower = address.to_ascii_lowercase();
    if lower.starts_with("bc1") || lower.starts_with("tb1") {
        let payload = &lower[3..];
        let charset_ok = !payload.is_empty()
            && payload
                .bytes()
                .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'h' | b'j'..=b'n' | b'p'..=b'z'));
        if (14..=90).contains(&lower.len()) && charset_ok {
            return Some(lower);
        }
        return None;
    }
    if (26..=62).contains(&address.len())
        && base58_bytes(address)
        && matches!(address.as_bytes()[0], b'1' | b'3' | b'm' | b'n' | b'2')
    {
        return Some(address.to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    const ACME: &str = "acme.testnet";
    const GUARDIAN: &str = "guardian.testnet";
    const BOB: &str = "bob.testnet";
    const ETH: &str = "0x4e8f1c2a9b7d6e5c3a18f0d4b27c91aa06e35d17";
    const ETH_NEXT: &str = "0x1111111111111111111111111111111111111111";
    const SOL: &str = "4fYNw3dojWmQ4dXtSGE9epjRGy9pFSx62YypT7avPYvA";
    const BTC: &str = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
    const T0: u64 = 1_700_000_000_000_000_000;

    fn use_account(account: &str, timestamp_ns: u64) {
        let context = VMContextBuilder::new()
            .current_account_id("plock.testnet".parse().unwrap())
            .predecessor_account_id(account.parse().unwrap())
            .signer_account_id(account.parse().unwrap())
            .block_timestamp(timestamp_ns)
            .attached_deposit(NearToken::from_near(1))
            .build();
        testing_env!(context);
    }

    fn setup() -> Contract {
        use_account(ACME, T0);
        Contract::init(1)
    }

    fn register_acme(contract: &mut Contract) {
        contract.register(
            "Acme Treasury".to_string(),
            Some(GUARDIAN.parse().unwrap()),
            60,
            vec![
                ChainAddress {
                    chain: "ethereum".to_string(),
                    address: ETH.to_string(),
                },
                ChainAddress {
                    chain: "sol".to_string(),
                    address: SOL.to_string(),
                },
                ChainAddress {
                    chain: "btc".to_string(),
                    address: BTC.to_string(),
                },
                ChainAddress {
                    chain: "near".to_string(),
                    address: ACME.to_string(),
                },
            ],
        );
    }

    fn verify(contract: &Contract, chain: &str, address: &str) -> VerifyResult {
        contract.verify(
            ACME.parse().unwrap(),
            chain.to_string(),
            address.to_string(),
        )
    }

    #[test]
    fn register_then_verify_matches_only_the_real_address() {
        let mut contract = setup();
        register_acme(&mut contract);

        let matched = verify(&contract, "ethereum", ETH);
        assert_eq!(matched.status, "match");
        assert_eq!(matched.display_name.as_deref(), Some("Acme Treasury"));
        assert_eq!(matched.current.as_deref(), Some(ETH));

        // EVM comparison is case-insensitive, and eth/evm are the same chain.
        assert_eq!(
            verify(&contract, "evm", &ETH.to_ascii_uppercase()).status,
            "match"
        );
        assert_eq!(
            verify(
                &contract,
                "eth",
                "0x0000000000000000000000000000000000000001"
            )
            .status,
            "no_match"
        );
        assert_eq!(verify(&contract, "solana", SOL).status, "match");
        assert_eq!(verify(&contract, "bitcoin", BTC).status, "match");

        let unknown = contract.verify(
            "missing.testnet".parse().unwrap(),
            "ethereum".to_string(),
            ETH.to_string(),
        );
        assert_eq!(unknown.status, "not_registered");
        assert!(get_logs()
            .iter()
            .any(|line| line.contains("payee_registered")));
    }

    #[test]
    fn proposal_keeps_the_old_address_authoritative() {
        let mut contract = setup();
        register_acme(&mut contract);
        contract.propose_address("ethereum".to_string(), ETH_NEXT.to_string());

        assert_eq!(verify(&contract, "ethereum", ETH).status, "match");
        let pending = verify(&contract, "ethereum", ETH_NEXT);
        assert_eq!(pending.status, "pending_change");
        assert_eq!(pending.current.as_deref(), Some(ETH));
        assert!(pending.activates_at_ms.unwrap() > now_ms());

        let view = contract.get_payee(ACME.parse().unwrap()).unwrap();
        let eth = view
            .addresses
            .iter()
            .find(|item| item.chain == "ethereum")
            .unwrap();
        assert_eq!(eth.current.as_deref(), Some(ETH));
        assert_eq!(eth.pending.as_deref(), Some(ETH_NEXT));
        assert!(!eth.needs_settle);
        assert!(get_logs()
            .iter()
            .any(|line| line.contains("\"event\":\"address_proposed\"")));
    }

    #[test]
    fn guardian_can_veto_and_the_owner_can_veto_their_own_proposal() {
        let mut contract = setup();
        register_acme(&mut contract);
        contract.propose_address("ethereum".to_string(), ETH_NEXT.to_string());

        use_account(GUARDIAN, T0 + 2_000_000_000);
        contract.veto(ACME.parse().unwrap(), "ethereum".to_string());
        assert_eq!(verify(&contract, "ethereum", ETH).status, "match");
        assert_eq!(verify(&contract, "ethereum", ETH_NEXT).status, "no_match");
        assert!(get_logs()
            .iter()
            .any(|line| line.contains("address_vetoed")));

        use_account(ACME, T0 + 3_000_000_000);
        contract.propose_address("base".to_string(), ETH_NEXT.to_string());
        contract.veto(ACME.parse().unwrap(), "base".to_string());
        assert_eq!(verify(&contract, "base", ETH_NEXT).status, "no_match");
    }

    #[test]
    #[should_panic(expected = "only the payee or the guardian can veto")]
    fn a_stranger_cannot_veto() {
        let mut contract = setup();
        register_acme(&mut contract);
        contract.propose_address("ethereum".to_string(), ETH_NEXT.to_string());
        use_account(BOB, T0 + 1_000_000_000);
        contract.veto(ACME.parse().unwrap(), "ethereum".to_string());
    }

    #[test]
    #[should_panic(expected = "payee is not registered")]
    fn a_guardian_cannot_propose_for_the_payee() {
        let mut contract = setup();
        register_acme(&mut contract);
        // Proposals are authenticated as the predecessor: the guardian account
        // has no payee record of its own, so the call cannot rewrite Acme.
        use_account(GUARDIAN, T0);
        contract.propose_address("ethereum".to_string(), ETH_NEXT.to_string());
    }

    #[test]
    fn change_activates_only_after_the_delay_and_settle_records_it() {
        let mut contract = setup();
        register_acme(&mut contract);
        contract.propose_address("ethereum".to_string(), ETH_NEXT.to_string());

        let just_before = T0 + 60 * 1_000_000_000 - 1;
        use_account(ACME, just_before);
        assert_eq!(verify(&contract, "ethereum", ETH).status, "match");
        assert_eq!(
            verify(&contract, "ethereum", ETH_NEXT).status,
            "pending_change"
        );

        let at_deadline = T0 + 60 * 1_000_000_000;
        use_account(BOB, at_deadline);
        assert_eq!(verify(&contract, "ethereum", ETH_NEXT).status, "match");
        assert_eq!(verify(&contract, "ethereum", ETH).status, "no_match");
        let eth = contract
            .get_payee(ACME.parse().unwrap())
            .unwrap()
            .addresses
            .into_iter()
            .find(|item| item.chain == "ethereum")
            .unwrap();
        assert!(eth.needs_settle);
        assert_eq!(eth.current.as_deref(), Some(ETH_NEXT));

        assert!(contract.settle(ACME.parse().unwrap(), "ethereum".to_string()));
        assert!(!contract.settle(ACME.parse().unwrap(), "ethereum".to_string()));
        let view = contract.get_payee(ACME.parse().unwrap()).unwrap();
        let eth = view
            .addresses
            .iter()
            .find(|item| item.chain == "ethereum")
            .unwrap();
        assert_eq!(eth.current.as_deref(), Some(ETH_NEXT));
        assert!(eth.pending.is_none());
        assert!(!eth.needs_settle);
        assert!(get_logs()
            .iter()
            .any(|line| line.contains("address_activated")));
    }

    #[test]
    #[should_panic(expected = "the delay has elapsed and the change is already effective")]
    fn veto_after_the_delay_is_rejected() {
        let mut contract = setup();
        register_acme(&mut contract);
        contract.propose_address("ethereum".to_string(), ETH_NEXT.to_string());
        use_account(GUARDIAN, T0 + 60 * 1_000_000_000);
        contract.veto(ACME.parse().unwrap(), "ethereum".to_string());
    }

    #[test]
    #[should_panic(expected = "a change is already pending")]
    fn second_proposal_is_rejected_while_one_is_pending() {
        let mut contract = setup();
        register_acme(&mut contract);
        contract.propose_address("ethereum".to_string(), ETH_NEXT.to_string());
        contract.propose_address(
            "ethereum".to_string(),
            "0x2222222222222222222222222222222222222222".to_string(),
        );
    }

    #[test]
    fn owner_cannot_dismiss_guardian_but_guardian_can_rotate() {
        let mut contract = setup();
        register_acme(&mut contract);
        use_account(GUARDIAN, T0 + 1_000_000_000);
        contract.set_guardian(ACME.parse().unwrap(), "other.testnet".parse().unwrap());
        let view = contract.get_payee(ACME.parse().unwrap()).unwrap();
        assert_eq!(view.guardian.as_deref(), Some("other.testnet"));
        assert!(get_logs().iter().any(|line| line.contains("guardian_set")));
    }

    #[test]
    #[should_panic(expected = "only the current guardian can rotate the guardian")]
    fn owner_cannot_replace_a_guardian() {
        let mut contract = setup();
        register_acme(&mut contract);
        contract.set_guardian(ACME.parse().unwrap(), "other.testnet".parse().unwrap());
    }

    #[test]
    fn payee_without_a_guardian_can_appoint_one() {
        let mut contract = setup();
        contract.register(
            "Globex".to_string(),
            None,
            60,
            vec![ChainAddress {
                chain: "ethereum".to_string(),
                address: ETH.to_string(),
            }],
        );
        contract.set_guardian(ACME.parse().unwrap(), GUARDIAN.parse().unwrap());
        assert_eq!(
            contract
                .get_payee(ACME.parse().unwrap())
                .unwrap()
                .guardian
                .as_deref(),
            Some(GUARDIAN)
        );
    }

    #[test]
    #[should_panic(expected = "delay is shorter than this contract's minimum")]
    fn delay_below_the_floor_is_rejected() {
        let mut contract = setup();
        contract.register(
            "Too Fast".to_string(),
            None,
            0,
            vec![ChainAddress {
                chain: "ethereum".to_string(),
                address: ETH.to_string(),
            }],
        );
    }

    #[test]
    #[should_panic(expected = "address is not valid for that chain")]
    fn malformed_ethereum_address_is_rejected() {
        let mut contract = setup();
        contract.register(
            "Bad Address".to_string(),
            None,
            60,
            vec![ChainAddress {
                chain: "ethereum".to_string(),
                address: "0x1234".to_string(),
            }],
        );
    }

    #[test]
    #[should_panic(expected = "payee is already registered")]
    fn double_register_is_rejected() {
        let mut contract = setup();
        register_acme(&mut contract);
        register_acme(&mut contract);
    }

    #[test]
    fn activity_is_newest_first_and_finds_payee_by_name() {
        let mut contract = setup();
        register_acme(&mut contract);
        contract.propose_address("ethereum".to_string(), ETH_NEXT.to_string());
        let activity = contract.get_activity(Some(ACME.parse().unwrap()), Some(10));
        assert_eq!(activity[0].kind, "address_proposed");
        assert_eq!(activity[1].kind, "payee_registered");
        let found = contract.find_payee("acme".to_string());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].account_id, ACME);
        assert_eq!(
            contract.get_config().recommended_delay_seconds,
            72 * 60 * 60
        );
        assert_eq!(contract.get_config().min_delay_seconds, 1);
    }

    #[test]
    #[should_panic(expected = "proposed address matches the current address")]
    fn proposing_the_current_address_is_rejected() {
        let mut contract = setup();
        register_acme(&mut contract);
        contract.propose_address("ethereum".to_string(), ETH.to_string());
    }

    #[test]
    fn adding_a_new_chain_is_time_locked() {
        let mut contract = setup();
        register_acme(&mut contract);
        let fresh = "0x3333333333333333333333333333333333333333";
        contract.propose_address("base".to_string(), fresh.to_string());
        assert_eq!(verify(&contract, "base", fresh).status, "pending_change");
        let view = contract.get_payee(ACME.parse().unwrap()).unwrap();
        let base = view
            .addresses
            .iter()
            .find(|item| item.chain == "base")
            .unwrap();
        assert!(base.current.is_none());
        assert_eq!(base.pending.as_deref(), Some(fresh));
    }
}
