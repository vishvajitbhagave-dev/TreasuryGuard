#![no_std]
use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, contracterror, token, Address, Env, Map, Symbol, Vec, String, BytesN
};

// Interface for inter-contract calls to the Registry
#[contractclient(name = "RegistryClient")]
pub trait RegistryInterface {
    fn register_vault(env: Env, vault: Address);
    fn log_activity(env: Env, user: Address, activity_type: Symbol);
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotAMember = 2,
    AmountMustBePositive = 3,
    RequestNotPending = 4,
    AlreadyApproved = 5,
    NotAuthorized = 6,
    InsufficientBalance = 7,
    InvalidRole = 8,
    AmountExceedsLimit = 9,
    CategoryRestricted = 10,
    VaultPaused = 11,
    RequestNotFound = 12,
    EmptyComment = 13,
    CategoryBudgetExceeded = 14,
}

// Member roles: Owner manages rules/members and can do everything,
// Approver can approve/execute requests, Contributor can deposit/request,
// Viewer is read-only.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Role {
    Owner,
    Approver,
    Contributor,
    Viewer,
}

// Accepts lowercase role names: "owner" | "approver" | "contributor" | "viewer"
pub fn parse_role(env: &Env, role_str: &String) -> Option<Role> {
    if role_str == &String::from_str(env, "owner") {
        Some(Role::Owner)
    } else if role_str == &String::from_str(env, "approver") {
        Some(Role::Approver)
    } else if role_str == &String::from_str(env, "contributor") {
        Some(Role::Contributor)
    } else if role_str == &String::from_str(env, "viewer") {
        Some(Role::Viewer)
    } else {
        None
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultConfig {
    pub admin: Address,
    pub token: Address,
    pub registry: Address,
    pub threshold: u32,
    pub name: String,
    pub purpose: String,
}

// Owner-configurable spending rules enforced at request submission.
// max_request_amount of 0 means no limit.
// monthly_target is the expected contribution per member per calendar month
// (0 disables monthly contribution tracking).
// category_caps maps a category to the maximum combined pending + executed
// spending allowed in one calendar month (absent key or 0 = unlimited).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpendingRules {
    pub max_request_amount: i128,
    pub blocked_categories: Vec<String>,
    pub monthly_target: i128,
    pub category_caps: Map<String, i128>,
}

// A member's recurring contribution plan (feature: recurring contributions).
// Each calendar month the vault may pull `amount` from the member via the
// token allowance they granted. last_period records the month last charged
// so a plan is charged at most once per period.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributionPlan {
    pub subscriber: Address,
    pub amount: i128,
    pub active: bool,
    pub last_period: u32,
}

// Discussion thread entry attached to a spending request (feature: comments).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Comment {
    pub author: Address,
    pub text: String,
    pub created_at: u64,
}

// Per-member cumulative deposits for one calendar month (feature:
// monthly contribution tracking). period = year*12 + month (UTC).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributionKey {
    pub member: Address,
    pub period: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpendingRequest {
    pub id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub category: String,
    pub description: String,
    pub receipt_url: String,
    pub approvals_count: u32,
    pub status: u32, // 0 = Pending, 1 = Executed, 2 = Cancelled
    pub created_at: u64,
    pub proposer: Address,
}

#[contracttype]
pub enum DataKey {
    Config,
    Members,       // Vec<Address>
    Roles,         // Map<Address, Role>
    Rules,         // SpendingRules
    Paused,        // bool
    Comments(u64), // Vec<Comment> for request id
    Contribution(ContributionKey), // i128 cumulative deposit amount
    Plan(Address), // ContributionPlan for a member (recurring contributions)
    Request(u64),
    Approved(u64, Address),
    RequestCount,
}

// UTC calendar month index (year * 12 + month) from a unix timestamp.
// Shared by contribution tracking so contract and UI agree on periods.
pub fn month_period(ts: u64) -> u32 {
    let days = (ts / 86_400) as i64;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    ((y + if m <= 2 { 1 } else { 0 }) as u32) * 12 + (m - 1) as u32
}

#[contract]
pub struct VaultContract;

#[contractimpl]
impl VaultContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        registry: Address,
        threshold: u32,
        members: Vec<Address>,
        roles: Vec<String>,
        name: String,
        purpose: String,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        if members.len() != roles.len() {
            return Err(Error::InvalidRole);
        }

        let mut role_map: Map<Address, Role> = Map::new(&env);
        for i in 0..members.len() {
            let member = members.get(i).unwrap();
            let parsed = parse_role(&env, &roles.get(i).unwrap()).ok_or(Error::InvalidRole)?;
            role_map.set(member.clone(), parsed);
        }
        // The admin is always an Owner
        role_map.set(admin.clone(), Role::Owner);

        let config = VaultConfig {
            admin: admin.clone(),
            token,
            registry: registry.clone(),
            threshold,
            name,
            purpose,
        };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::Members, &members);
        env.storage().instance().set(&DataKey::Roles, &role_map);
        env.storage().instance().set(&DataKey::RequestCount, &0u64);

        // Inter-contract call to register itself
        let registry_client = RegistryClient::new(&env, &registry);
        registry_client.register_vault(&env.current_contract_address());
        
        Ok(())
    }

    // Returns the caller's role, treating the admin as Owner
    fn get_role(env: &Env, user: &Address) -> Option<Role> {
        let config: VaultConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        if *user == config.admin {
            return Some(Role::Owner);
        }
        let roles: Map<Address, Role> = env.storage().instance().get(&DataKey::Roles).unwrap();
        roles.get(user.clone())
    }

    fn require_role(env: &Env, user: &Address, allowed: &[Role]) -> Result<(), Error> {
        match VaultContract::get_role(env, user) {
            Some(role) => {
                for r in allowed.iter() {
                    if *r == role {
                        return Ok(());
                    }
                }
                Err(Error::NotAuthorized)
            }
            None => Err(Error::NotAMember),
        }
    }

    pub fn deposit(env: Env, from: Address, amount: i128) -> Result<(), Error> {
        from.require_auth();
        Self::require_role(&env, &from, &[Role::Owner, Role::Contributor])?;
        if amount <= 0 {
            return Err(Error::AmountMustBePositive);
        }

        let config: VaultConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        let token_client = token::Client::new(&env, &config.token);
        
        // Transfer funds from sender to this contract
        token_client.transfer(&from, &env.current_contract_address(), &amount);

        // Record this member's contribution for monthly tracking
        let period = month_period(env.ledger().timestamp());
        let key = ContributionKey { member: from.clone(), period };
        let current = env.storage().instance().get::<DataKey, i128>(&DataKey::Contribution(key.clone())).unwrap_or(0);
        env.storage().instance().set(&DataKey::Contribution(key), &(current + amount));

        // Inter-contract call to registry to log activity
        let registry_client = RegistryClient::new(&env, &config.registry);
        registry_client.log_activity(&from, &Symbol::new(&env, "deposit"));

        // Emit event
        env.events().publish(
            (Symbol::new(&env, "deposit"), from),
            amount,
        );

        Ok(())
    }

    pub fn submit_request(
        env: Env,
        proposer: Address,
        recipient: Address,
        amount: i128,
        category: String,
        description: String,
        receipt_url: String,
    ) -> Result<u64, Error> {
        proposer.require_auth();
        
        // Only Owner and Contributor may submit spending requests
        Self::require_role(&env, &proposer, &[Role::Owner, Role::Contributor])?;

        if amount <= 0 {
            return Err(Error::AmountMustBePositive);
        }

        // Rule engine: enforce owner-configured spending limits
        if let Some(rules) = env.storage().instance().get::<DataKey, SpendingRules>(&DataKey::Rules) {
            if rules.max_request_amount > 0 && amount > rules.max_request_amount {
                return Err(Error::AmountExceedsLimit);
            }
            for blocked in rules.blocked_categories.iter() {
                if blocked == category {
                    return Err(Error::CategoryRestricted);
                }
            }
            // Budget caps per category (feature: budget caps). Pending and
            // executed requests of the current calendar month count against
            // the cap; a cap of 0 (or absent) means unlimited.
            if let Some(cap) = rules.category_caps.get(category.clone()) {
                if cap > 0 {
                    let period = month_period(env.ledger().timestamp());
                    let spent = Self::category_spend_in_period(&env, &category, period);
                    if spent + amount > cap {
                        return Err(Error::CategoryBudgetExceeded);
                    }
                }
            }
        }

        let mut count: u64 = env.storage().instance().get(&DataKey::RequestCount).unwrap_or(0);
        count += 1;
        env.storage().instance().set(&DataKey::RequestCount, &count);

        let request = SpendingRequest {
            id: count,
            recipient,
            amount,
            category,
            description,
            receipt_url,
            approvals_count: 0,
            status: 0, // Pending
            created_at: env.ledger().timestamp(),
            proposer: proposer.clone(),
        };
        env.storage().instance().set(&DataKey::Request(count), &request);

        let config: VaultConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        let registry_client = RegistryClient::new(&env, &config.registry);
        registry_client.log_activity(&proposer, &Symbol::new(&env, "submit_request"));

        env.events().publish(
            (Symbol::new(&env, "request_submitted"), proposer),
            count,
        );

        Ok(count)
    }

    pub fn approve_request(env: Env, approver: Address, request_id: u64) -> Result<(), Error> {
        approver.require_auth();

        // Only Owner and Approver may approve
        Self::require_role(&env, &approver, &[Role::Owner, Role::Approver])?;

        let mut request: SpendingRequest = env
            .storage()
            .instance()
            .get(&DataKey::Request(request_id))
            .unwrap();

        if request.status != 0 {
            return Err(Error::RequestNotPending);
        }

        let approved_key = DataKey::Approved(request_id, approver.clone());
        if env.storage().persistent().has(&approved_key) {
            return Err(Error::AlreadyApproved);
        }

        env.storage().persistent().set(&approved_key, &true);
        request.approvals_count += 1;
        env.storage().instance().set(&DataKey::Request(request_id), &request);

        let config: VaultConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        let registry_client = RegistryClient::new(&env, &config.registry);
        registry_client.log_activity(&approver, &Symbol::new(&env, "approve_request"));

        env.events().publish(
            (Symbol::new(&env, "request_approved"), approver),
            request_id,
        );

        Ok(())
    }

    pub fn execute_request(env: Env, executor: Address, request_id: u64) -> Result<(), Error> {
        executor.require_auth();

        // Only Owner and Approver may execute
        Self::require_role(&env, &executor, &[Role::Owner, Role::Approver])?;

        // Emergency pause: withdrawals are blocked while the vault is paused
        if Self::is_paused_internal(&env) {
            return Err(Error::VaultPaused);
        }

        let config: VaultConfig = env.storage().instance().get(&DataKey::Config).unwrap();

        let mut request: SpendingRequest = env
            .storage()
            .instance()
            .get(&DataKey::Request(request_id))
            .unwrap();

        if request.status != 0 {
            return Err(Error::RequestNotPending);
        }

        if request.approvals_count < config.threshold {
            return Err(Error::NotAuthorized);
        }

        // Check vault balance
        let token_client = token::Client::new(&env, &config.token);
        let balance = token_client.balance(&env.current_contract_address());
        if balance < request.amount {
            return Err(Error::InsufficientBalance);
        }

        // Execute withdrawal payment
        token_client.transfer(&env.current_contract_address(), &request.recipient, &request.amount);

        // Update request status
        request.status = 1; // Executed
        env.storage().instance().set(&DataKey::Request(request_id), &request);

        // Log to Registry
        let registry_client = RegistryClient::new(&env, &config.registry);
        registry_client.log_activity(&executor, &Symbol::new(&env, "execute_request"));

        env.events().publish(
            (Symbol::new(&env, "request_executed"), executor),
            request_id,
        );

        Ok(())
    }

    pub fn cancel_request(env: Env, canceller: Address, request_id: u64) -> Result<(), Error> {
        canceller.require_auth();

        let config: VaultConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        let mut request: SpendingRequest = env
            .storage()
            .instance()
            .get(&DataKey::Request(request_id))
            .unwrap();

        if request.status != 0 {
            return Err(Error::RequestNotPending);
        }

        // Only admin or proposer can cancel
        if canceller != config.admin && canceller != request.proposer {
            return Err(Error::NotAuthorized);
        }

        request.status = 2; // Cancelled
        env.storage().instance().set(&DataKey::Request(request_id), &request);

        env.events().publish(
            (Symbol::new(&env, "request_cancelled"), canceller),
            request_id,
        );

        Ok(())
    }

    // Rule engine configuration (Owner only)
    pub fn set_rules(
        env: Env,
        caller: Address,
        max_request_amount: i128,
        blocked_categories: Vec<String>,
        monthly_target: i128,
        category_caps: Map<String, i128>,
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::require_role(&env, &caller, &[Role::Owner])?;

        let rules = SpendingRules {
            max_request_amount,
            blocked_categories,
            monthly_target,
            category_caps,
        };
        env.storage().instance().set(&DataKey::Rules, &rules);
        Ok(())
    }

    pub fn get_rules(env: Env) -> SpendingRules {
        env.storage().instance().get(&DataKey::Rules).unwrap_or_else(|| SpendingRules {
            max_request_amount: 0,
            blocked_categories: Vec::new(&env),
            monthly_target: 0,
            category_caps: Map::new(&env),
        })
    }

    // Comments on a spending request (feature: comment on requests).
    // Any member may comment while the request is still pending.
    pub fn add_comment(env: Env, commenter: Address, request_id: u64, text: String) -> Result<(), Error> {
        commenter.require_auth();

        // Any recognized member (including viewers) can join the discussion
        Self::require_role(&env, &commenter, &[Role::Owner, Role::Approver, Role::Contributor, Role::Viewer])?;

        let request: SpendingRequest = env
            .storage()
            .instance()
            .get(&DataKey::Request(request_id))
            .ok_or(Error::RequestNotFound)?;

        if request.status != 0 {
            return Err(Error::RequestNotPending);
        }
        if text.len() == 0 {
            return Err(Error::EmptyComment);
        }

        let mut comments: Vec<Comment> = env
            .storage()
            .instance()
            .get(&DataKey::Comments(request_id))
            .unwrap_or_else(|| Vec::new(&env));
        comments.push_back(Comment {
            author: commenter.clone(),
            text,
            created_at: env.ledger().timestamp(),
        });
        env.storage().instance().set(&DataKey::Comments(request_id), &comments);

        let config: VaultConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        let registry_client = RegistryClient::new(&env, &config.registry);
        registry_client.log_activity(&commenter, &Symbol::new(&env, "add_comment"));

        env.events().publish(
            (Symbol::new(&env, "comment_added"), commenter),
            request_id,
        );

        Ok(())
    }

    pub fn get_comments(env: Env, request_id: u64) -> Vec<Comment> {
        env.storage()
            .instance()
            .get(&DataKey::Comments(request_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    // Cumulative amount a member deposited during a calendar month period.
    pub fn get_contribution(env: Env, member: Address, period: u32) -> i128 {
        let key = ContributionKey { member, period };
        env.storage()
            .instance()
            .get::<DataKey, i128>(&DataKey::Contribution(key))
            .unwrap_or(0)
    }

    // Combined pending + executed spending for one category inside a
    // calendar-month period (feature: budget caps).
    fn category_spend_in_period(env: &Env, category: &String, period: u32) -> i128 {
        let count: u64 = env.storage().instance().get(&DataKey::RequestCount).unwrap_or(0);
        let mut total = 0i128;
        if count == 0 {
            return total;
        }
        for id in 1..=count {
            if let Some(request) = env.storage().instance().get::<DataKey, SpendingRequest>(&DataKey::Request(id)) {
                // Cancelled requests do not consume budget
                if request.status == 2 {
                    continue;
                }
                if request.category != *category {
                    continue;
                }
                if month_period(request.created_at) != period {
                    continue;
                }
                total += request.amount;
            }
        }
        total
    }

    // Recurring contributions (feature: recurring contributions).
    // A member registers a monthly amount; the vault pulls it each month via
    // the token allowance the member granted to the contract.
    pub fn set_contribution_plan(env: Env, caller: Address, amount: i128) -> Result<(), Error> {
        caller.require_auth();
        Self::require_role(&env, &caller, &[Role::Owner, Role::Contributor])?;
        if amount <= 0 {
            return Err(Error::AmountMustBePositive);
        }

        let plan = ContributionPlan {
            subscriber: caller.clone(),
            amount,
            active: true,
            // 0 = never charged yet, so the first pull covers the
            // current month as soon as an allowance is granted.
            last_period: 0,
        };
        env.storage().instance().set(&DataKey::Plan(caller.clone()), &plan);

        env.events().publish(
            (Symbol::new(&env, "plan_set"), caller),
            amount,
        );

        Ok(())
    }

    pub fn cancel_contribution_plan(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        Self::require_role(&env, &caller, &[Role::Owner, Role::Contributor])?;

        let key = DataKey::Plan(caller.clone());
        let mut plan: ContributionPlan = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::NotAMember)?;
        plan.active = false;
        env.storage().instance().set(&key, &plan);

        env.events().publish(
            (Symbol::new(&env, "plan_cancelled"), caller),
            (),
        );

        Ok(())
    }

    pub fn get_contribution_plan(env: Env, member: Address) -> Option<ContributionPlan> {
        env.storage().instance().get(&DataKey::Plan(member))
    }

    // Charges every active plan that is due for the current calendar month.
    // Callable by anyone so charging does not depend on a member being
    // online. Members whose allowance or balance cannot cover the charge are
    // skipped. Returns the number of plans charged.
    pub fn run_due_contributions(env: Env) -> u32 {
        let config: VaultConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        let token_client = token::Client::new(&env, &config.token);
        let vault = env.current_contract_address();
        let period = month_period(env.ledger().timestamp());

        let members: Vec<Address> = env.storage().instance().get(&DataKey::Members).unwrap_or_else(|| Vec::new(&env));
        let mut charged: u32 = 0;

        for member in members.iter() {
            let key = DataKey::Plan(member.clone());
            let plan: ContributionPlan = match env.storage().instance().get(&key) {
                Some(p) => p,
                None => continue,
            };
            if !plan.active || plan.last_period >= period {
                continue;
            }

            // Skip members who have not granted (or revoked) enough allowance,
            // or whose balance cannot cover the charge.
            if token_client.allowance(&member, &vault) < plan.amount {
                continue;
            }
            if token_client.balance(&member) < plan.amount {
                continue;
            }

            token_client.transfer_from(&vault, &member, &vault, &plan.amount);

            let ckey = ContributionKey { member: member.clone(), period };
            let current = env.storage().instance().get::<DataKey, i128>(&DataKey::Contribution(ckey.clone())).unwrap_or(0);
            env.storage().instance().set(&DataKey::Contribution(ckey), &(current + plan.amount));

            let mut updated = plan.clone();
            updated.last_period = period;
            env.storage().instance().set(&key, &updated);

            let registry_client = RegistryClient::new(&env, &config.registry);
            registry_client.log_activity(&member, &Symbol::new(&env, "auto_contribution"));

            env.events().publish(
                (Symbol::new(&env, "auto_contribution"), member),
                plan.amount,
            );

            charged += 1;
        }

        charged
    }

    // Emergency pause (Owner only). While paused, withdrawals cannot execute;
    // deposits, submissions and approvals are unaffected.
    pub fn set_paused(env: Env, caller: Address, paused: bool) -> Result<(), Error> {
        caller.require_auth();
        Self::require_role(&env, &caller, &[Role::Owner])?;

        env.storage().instance().set(&DataKey::Paused, &paused);

        let config: VaultConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        let registry_client = RegistryClient::new(&env, &config.registry);
        registry_client.log_activity(&caller, &Symbol::new(&env, "set_paused"));

        env.events().publish(
            (Symbol::new(&env, "pause_state_changed"), caller),
            paused,
        );

        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        Self::is_paused_internal(&env)
    }

    fn is_paused_internal(env: &Env) -> bool {
        env.storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Paused)
            .unwrap_or(false)
    }

    // Member management (Owner only). Upserts a member with the given role.
    pub fn set_member_role(env: Env, caller: Address, member: Address, role: String) -> Result<(), Error> {
        caller.require_auth();
        Self::require_role(&env, &caller, &[Role::Owner])?;

        let parsed = parse_role(&env, &role).ok_or(Error::InvalidRole)?;
        let mut roles: Map<Address, Role> = env.storage().instance().get(&DataKey::Roles).unwrap();
        roles.set(member.clone(), parsed);
        env.storage().instance().set(&DataKey::Roles, &roles);

        let mut members: Vec<Address> = env.storage().instance().get(&DataKey::Members).unwrap();
        let mut exists = false;
        for m in members.iter() {
            if m == member {
                exists = true;
                break;
            }
        }
        if !exists {
            members.push_back(member);
            env.storage().instance().set(&DataKey::Members, &members);
        }
        Ok(())
    }

    pub fn get_config(env: Env) -> VaultConfig {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    pub fn get_members(env: Env) -> Vec<Address> {
        env.storage().instance().get(&DataKey::Members).unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_member_role(env: Env, user: Address) -> Result<Role, Error> {
        Self::get_role(&env, &user).ok_or(Error::NotAMember)
    }

    pub fn get_request(env: Env, id: u64) -> SpendingRequest {
        env.storage().instance().get(&DataKey::Request(id)).unwrap()
    }

    pub fn get_request_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::RequestCount).unwrap_or(0)
    }

    pub fn is_approved(env: Env, id: u64, member: Address) -> bool {
        let approved_key = DataKey::Approved(id, member);
        env.storage().persistent().get(&approved_key).unwrap_or(false)
    }

    pub fn get_vault_balance(env: Env) -> i128 {
        let config: VaultConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        let token_client = token::Client::new(&env, &config.token);
        token_client.balance(&env.current_contract_address())
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let config: VaultConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        config.admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{Env, Address, Vec, String, Symbol};
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Ledger as _;

    #[contract]
    pub struct MockRegistry;

    #[contractimpl]
    impl MockRegistry {
        pub fn register_vault(env: Env, vault: Address) {
            env.events().publish((Symbol::new(&env, "vault_registered"),), vault);
        }
        pub fn log_activity(env: Env, user: Address, activity_type: Symbol) {
            env.events().publish((Symbol::new(&env, "activity_logged"), activity_type), user);
        }
    }

    fn str(env: &Env, s: &str) -> String {
        String::from_str(env, s)
    }

    #[test]
    fn test_vault_lifecycle() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user1 = Address::generate(&env); // contributor
        let user2 = Address::generate(&env); // approver
        let recipient = Address::generate(&env);

        let registry_address = Address::generate(&env);
        env.register_contract(&registry_address, MockRegistry);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(token_admin.clone());
        let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
        let token_info_client = soroban_sdk::token::Client::new(&env, &token_id);

        token_client.mint(&user1, &1000i128);

        let vault_address = Address::generate(&env);
        env.register_contract(&vault_address, VaultContract);
        let vault_client = VaultContractClient::new(&env, &vault_address);

        let mut members = Vec::new(&env);
        members.push_back(user1.clone());
        members.push_back(user2.clone());

        let mut roles = Vec::new(&env);
        roles.push_back(str(&env, "contributor"));
        roles.push_back(str(&env, "approver"));

        vault_client.initialize(
            &admin,
            &token_id,
            &registry_address,
            &2u32,
            &members,
            &roles,
            &str(&env, "Team Treasury"),
            &str(&env, "Shared fund for team expenses"),
        );

        let config = vault_client.get_config();
        assert_eq!(config.admin, admin);
        assert_eq!(config.token, token_id);
        assert_eq!(config.registry, registry_address);
        assert_eq!(config.threshold, 2);
        assert_eq!(config.name, str(&env, "Team Treasury"));
        assert_eq!(config.purpose, str(&env, "Shared fund for team expenses"));

        // Admin is implicitly Owner
        assert_eq!(vault_client.get_member_role(&admin), Role::Owner);
        assert_eq!(vault_client.get_member_role(&user1), Role::Contributor);
        assert_eq!(vault_client.get_member_role(&user2), Role::Approver);

        // Contributor deposits
        vault_client.deposit(&user1, &500i128);
        assert_eq!(vault_client.get_vault_balance(), 500i128);
        assert_eq!(token_info_client.balance(&user1), 500i128);

        // Contributor submits a categorized request
        let req_id = vault_client.submit_request(
            &user1,
            &recipient,
            &300i128,
            &str(&env, "Operations"),
            &str(&env, "Repair roof"),
            &str(&env, "https://receipts.example/roof.pdf"),
        );
        assert_eq!(req_id, 1);
        assert_eq!(vault_client.get_request_count(), 1);

        let request = vault_client.get_request(&1);
        assert_eq!(request.recipient, recipient);
        assert_eq!(request.amount, 300i128);
        assert_eq!(request.category, str(&env, "Operations"));
        assert_eq!(request.receipt_url, str(&env, "https://receipts.example/roof.pdf"));
        assert_eq!(request.approvals_count, 0);
        assert_eq!(request.status, 0);

        // Approver and Owner reach the threshold of 2
        vault_client.approve_request(&user2, &1);
        let request = vault_client.get_request(&1);
        assert_eq!(request.approvals_count, 1);
        assert!(vault_client.is_approved(&1, &user2));

        vault_client.approve_request(&admin, &1);
        let request = vault_client.get_request(&1);
        assert_eq!(request.approvals_count, 2);

        // Approver executes the withdrawal
        vault_client.execute_request(&user2, &1);

        let request = vault_client.get_request(&1);
        assert_eq!(request.status, 1);
        assert_eq!(vault_client.get_vault_balance(), 200i128);
        assert_eq!(token_info_client.balance(&recipient), 300i128);
    }

    #[test]
    fn test_unauthorized_submit() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user1 = Address::generate(&env);
        let non_member = Address::generate(&env);
        let recipient = Address::generate(&env);

        let registry_address = Address::generate(&env);
        env.register_contract(&registry_address, MockRegistry);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(token_admin.clone());

        let vault_address = Address::generate(&env);
        env.register_contract(&vault_address, VaultContract);
        let vault_client = VaultContractClient::new(&env, &vault_address);

        let mut members = Vec::new(&env);
        members.push_back(user1.clone());

        let mut roles = Vec::new(&env);
        roles.push_back(str(&env, "contributor"));

        vault_client.initialize(
            &admin,
            &token_id,
            &registry_address,
            &1u32,
            &members,
            &roles,
            &str(&env, "Team Treasury"),
            &str(&env, "Purpose"),
        );

        let res = vault_client.try_submit_request(
            &non_member,
            &recipient,
            &100i128,
            &str(&env, "Operations"),
            &str(&env, "Hacker attempt"),
            &str(&env, ""),
        );
        assert!(res.is_err());
    }

    #[test]
    fn test_role_permissions_enforced() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contributor = Address::generate(&env);
        let viewer = Address::generate(&env);
        let recipient = Address::generate(&env);

        let registry_address = Address::generate(&env);
        env.register_contract(&registry_address, MockRegistry);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(token_admin.clone());
        let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
        token_client.mint(&contributor, &1000i128);

        let vault_address = Address::generate(&env);
        env.register_contract(&vault_address, VaultContract);
        let vault_client = VaultContractClient::new(&env, &vault_address);

        let mut members = Vec::new(&env);
        members.push_back(contributor.clone());
        members.push_back(viewer.clone());

        let mut roles = Vec::new(&env);
        roles.push_back(str(&env, "contributor"));
        roles.push_back(str(&env, "viewer"));

        vault_client.initialize(
            &admin,
            &token_id,
            &registry_address,
            &1u32,
            &members,
            &roles,
            &str(&env, "Team Treasury"),
            &str(&env, "Purpose"),
        );

        // Viewer cannot deposit or approve
        let res = vault_client.try_deposit(&viewer, &100i128);
        assert!(res.is_err());

        // Contributor can deposit but cannot approve
        vault_client.deposit(&contributor, &200i128);
        let req_id = vault_client.submit_request(
            &contributor,
            &recipient,
            &50i128,
            &str(&env, "Payroll"),
            &str(&env, "Contractor payout"),
            &str(&env, ""),
        );
        let res = vault_client.try_approve_request(&contributor, &req_id);
        assert!(res.is_err());
        assert_eq!(vault_client.get_request(&req_id).approvals_count, 0);

        // Owner can approve and execute alone when threshold is 1
        vault_client.approve_request(&admin, &req_id);
        vault_client.execute_request(&admin, &req_id);
        assert_eq!(vault_client.get_request(&req_id).status, 1);
    }

    #[test]
    fn test_rule_engine_enforced() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contributor = Address::generate(&env);
        let recipient = Address::generate(&env);

        let registry_address = Address::generate(&env);
        env.register_contract(&registry_address, MockRegistry);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(token_admin.clone());
        let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
        token_client.mint(&contributor, &10000i128);

        let vault_address = Address::generate(&env);
        env.register_contract(&vault_address, VaultContract);
        let vault_client = VaultContractClient::new(&env, &vault_address);

        let mut members = Vec::new(&env);
        members.push_back(contributor.clone());

        let mut roles = Vec::new(&env);
        roles.push_back(str(&env, "contributor"));

        vault_client.initialize(
            &admin,
            &token_id,
            &registry_address,
            &1u32,
            &members,
            &roles,
            &str(&env, "Team Treasury"),
            &str(&env, "Purpose"),
        );

        // Non-owner cannot configure rules
        let mut blocked = Vec::new(&env);
        blocked.push_back(str(&env, "Marketing"));
        let no_caps = Map::new(&env);
        let res = vault_client.try_set_rules(&contributor, &1000i128, &blocked, &0i128, &no_caps);
        assert!(res.is_err());

        // Owner sets a per-request limit and a restricted category
        vault_client.set_rules(&admin, &1000i128, &blocked, &0i128, &no_caps);
        let rules = vault_client.get_rules();
        assert_eq!(rules.max_request_amount, 1000i128);
        assert_eq!(rules.blocked_categories.len(), 1);

        // Requests within limits succeed
        let ok_id = vault_client.submit_request(
            &contributor,
            &recipient,
            &500i128,
            &str(&env, "Operations"),
            &str(&env, "Within limit"),
            &str(&env, ""),
        );
        assert_eq!(ok_id, 1);

        // Oversized request is rejected
        let res = vault_client.try_submit_request(
            &contributor,
            &recipient,
            &2000i128,
            &str(&env, "Operations"),
            &str(&env, "Over limit"),
            &str(&env, ""),
        );
        assert!(res.is_err());

        // Restricted category is rejected
        let res = vault_client.try_submit_request(
            &contributor,
            &recipient,
            &100i128,
            &str(&env, "Marketing"),
            &str(&env, "Blocked category"),
            &str(&env, ""),
        );
        assert!(res.is_err());
    }

    #[test]
    fn test_emergency_pause() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contributor = Address::generate(&env);
        let recipient = Address::generate(&env);

        let registry_address = Address::generate(&env);
        env.register_contract(&registry_address, MockRegistry);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(token_admin.clone());
        let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
        token_client.mint(&contributor, &1000i128);

        let vault_address = Address::generate(&env);
        env.register_contract(&vault_address, VaultContract);
        let vault_client = VaultContractClient::new(&env, &vault_address);

        let mut members = Vec::new(&env);
        members.push_back(contributor.clone());

        let mut roles = Vec::new(&env);
        roles.push_back(str(&env, "contributor"));

        vault_client.initialize(
            &admin,
            &token_id,
            &registry_address,
            &1u32,
            &members,
            &roles,
            &str(&env, "Team Treasury"),
            &str(&env, "Purpose"),
        );

        assert!(!vault_client.is_paused());

        vault_client.deposit(&contributor, &500i128);
        let req_id = vault_client.submit_request(
            &contributor,
            &recipient,
            &100i128,
            &str(&env, "Operations"),
            &str(&env, "Repair roof"),
            &str(&env, ""),
        );
        vault_client.approve_request(&admin, &req_id);

        // Non-owner cannot toggle the pause
        let res = vault_client.try_set_paused(&contributor, &true);
        assert!(res.is_err());
        assert!(!vault_client.is_paused());

        // Owner pauses the vault
        vault_client.set_paused(&admin, &true);
        assert!(vault_client.is_paused());

        // Withdrawals are blocked while paused
        let res = vault_client.try_execute_request(&admin, &req_id);
        assert!(res.is_err());

        // Approvals and submissions still work while paused (withdrawals only)
        let req2 = vault_client.submit_request(
            &contributor,
            &recipient,
            &50i128,
            &str(&env, "Operations"),
            &str(&env, "While paused"),
            &str(&env, ""),
        );
        vault_client.approve_request(&admin, &req2);

        // Owner unpauses and the pending withdrawal executes
        vault_client.set_paused(&admin, &false);
        assert!(!vault_client.is_paused());
        vault_client.execute_request(&admin, &req_id);
        assert_eq!(vault_client.get_request(&req_id).status, 1);
    }

    #[test]
    fn test_comments() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contributor = Address::generate(&env);
        let viewer = Address::generate(&env);
        let non_member = Address::generate(&env);
        let recipient = Address::generate(&env);

        let registry_address = Address::generate(&env);
        env.register_contract(&registry_address, MockRegistry);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(token_admin.clone());

        let vault_address = Address::generate(&env);
        env.register_contract(&vault_address, VaultContract);
        let vault_client = VaultContractClient::new(&env, &vault_address);

        let mut members = Vec::new(&env);
        members.push_back(contributor.clone());
        members.push_back(viewer.clone());

        let mut roles = Vec::new(&env);
        roles.push_back(str(&env, "contributor"));
        roles.push_back(str(&env, "viewer"));

        vault_client.initialize(
            &admin,
            &token_id,
            &registry_address,
            &1u32,
            &members,
            &roles,
            &str(&env, "Team Treasury"),
            &str(&env, "Purpose"),
        );

        let req_id = vault_client.submit_request(
            &contributor,
            &recipient,
            &100i128,
            &str(&env, "Operations"),
            &str(&env, "Repair roof"),
            &str(&env, ""),
        );

        // Contributor discusses the pending request
        vault_client.add_comment(&contributor, &req_id, &str(&env, "Why so expensive?"));
        // Viewers can join the discussion too
        vault_client.add_comment(&viewer, &req_id, &str(&env, "Quote looks fair to me."));

        let comments = vault_client.get_comments(&req_id);
        assert_eq!(comments.len(), 2);
        assert_eq!(comments.get(0).unwrap().author, contributor);
        assert_eq!(comments.get(0).unwrap().text, str(&env, "Why so expensive?"));
        assert_eq!(comments.get(1).unwrap().text, str(&env, "Quote looks fair to me."));

        // Non-members cannot comment
        let res = vault_client.try_add_comment(&non_member, &req_id, &str(&env, "Spam"));
        assert!(res.is_err());

        // Empty comments are rejected
        let res = vault_client.try_add_comment(&contributor, &req_id, &str(&env, ""));
        assert!(res.is_err());

        // Comments on non-pending requests are rejected
        vault_client.cancel_request(&contributor, &req_id);
        let res = vault_client.try_add_comment(&contributor, &req_id, &str(&env, "Too late"));
        assert!(res.is_err());

        // Unknown request ids are rejected
        let res = vault_client.try_add_comment(&contributor, &999u64, &str(&env, "Ghost"));
        assert!(res.is_err());
    }

    #[test]
    fn test_monthly_contributions() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        let registry_address = Address::generate(&env);
        env.register_contract(&registry_address, MockRegistry);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(token_admin.clone());
        let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
        token_client.mint(&alice, &1000i128);
        token_client.mint(&bob, &1000i128);

        let vault_address = Address::generate(&env);
        env.register_contract(&vault_address, VaultContract);
        let vault_client = VaultContractClient::new(&env, &vault_address);

        let mut members = Vec::new(&env);
        members.push_back(alice.clone());
        members.push_back(bob.clone());

        let mut roles = Vec::new(&env);
        roles.push_back(str(&env, "contributor"));
        roles.push_back(str(&env, "contributor"));

        vault_client.initialize(
            &admin,
            &token_id,
            &registry_address,
            &1u32,
            &members,
            &roles,
            &str(&env, "Team Treasury"),
            &str(&env, "Purpose"),
        );

        // Owner sets a monthly contribution target of 100
        let no_blocked: Vec<String> = Vec::new(&env);
        let no_caps = Map::new(&env);
        vault_client.set_rules(&admin, &0i128, &no_blocked, &100i128, &no_caps);
        assert_eq!(vault_client.get_rules().monthly_target, 100i128);

        // Both contribute in the same month (Nov 2023)
        env.ledger().with_mut(|li| li.timestamp = 1_700_000_000);
        let period_nov = month_period(1_700_000_000);
        vault_client.deposit(&alice, &100i128);
        vault_client.deposit(&bob, &40i128);

        // Alice tops up later in the same month; amounts accumulate
        vault_client.deposit(&alice, &50i128);

        assert_eq!(vault_client.get_contribution(&alice, &period_nov), 150i128);
        assert_eq!(vault_client.get_contribution(&bob, &period_nov), 40i128);

        // A deposit in the next month lands in its own bucket (Dec 2023)
        env.ledger().with_mut(|li| li.timestamp = 1_700_000_000 + 40 * 86_400);
        let period_dec = month_period(1_700_000_000 + 40 * 86_400);
        assert_ne!(period_dec, period_nov);
        vault_client.deposit(&bob, &60i128);

        assert_eq!(vault_client.get_contribution(&bob, &period_dec), 60i128);
        assert_eq!(vault_client.get_contribution(&bob, &period_nov), 40i128);

        // Members who never deposited read as zero
        assert_eq!(vault_client.get_contribution(&admin, &period_dec), 0i128);
    }

    #[test]
    fn test_category_budget_caps() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contributor = Address::generate(&env);
        let recipient = Address::generate(&env);

        let registry_address = Address::generate(&env);
        env.register_contract(&registry_address, MockRegistry);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(token_admin.clone());
        token::StellarAssetClient::new(&env, &token_id).mint(&contributor, &10_000i128);

        let vault_address = Address::generate(&env);
        env.register_contract(&vault_address, VaultContract);
        let vault_client = VaultContractClient::new(&env, &vault_address);

        let mut members = Vec::new(&env);
        members.push_back(contributor.clone());
        let mut roles = Vec::new(&env);
        roles.push_back(str(&env, "contributor"));

        vault_client.initialize(
            &admin,
            &token_id,
            &registry_address,
            &1u32,
            &members,
            &roles,
            &str(&env, "Team Treasury"),
            &str(&env, "Purpose"),
        );

        // Owner caps "Repairs" at 300 per calendar month
        let mut caps = Map::new(&env);
        caps.set(str(&env, "Repairs"), 300i128);
        let no_blocked: Vec<String> = Vec::new(&env);
        vault_client.set_rules(&admin, &0i128, &no_blocked, &0i128, &caps);

        // First request within the cap succeeds
        vault_client.submit_request(
            &contributor,
            &recipient,
            &250i128,
            &str(&env, "Repairs"),
            &str(&env, "Fix gate"),
            &str(&env, ""),
        );

        // A second request would exceed the monthly cap (250 + 100 > 300)
        let res = vault_client.try_submit_request(
            &contributor,
            &recipient,
            &100i128,
            &str(&env, "Repairs"),
            &str(&env, "Over cap"),
            &str(&env, ""),
        );
        assert!(res.is_err());

        // Exactly hitting the cap is still allowed (250 + 50 = 300)
        vault_client.submit_request(
            &contributor,
            &recipient,
            &50i128,
            &str(&env, "Repairs"),
            &str(&env, "Top-up within cap"),
            &str(&env, ""),
        );

        // Other categories are unaffected by the Repairs cap
        vault_client.submit_request(
            &contributor,
            &recipient,
            &500i128,
            &str(&env, "Events"),
            &str(&env, "Festival budget"),
            &str(&env, ""),
        );

        // Cancelling a pending request frees its share of the budget
        vault_client.cancel_request(&contributor, &1);
        vault_client.submit_request(
            &contributor,
            &recipient,
            &100i128,
            &str(&env, "Repairs"),
            &str(&env, "Fits after cancel"),
            &str(&env, ""),
        );

        // Next calendar month starts with a fresh budget
        env.ledger().with_mut(|li| li.timestamp = 1_700_000_000 + 31 * 86_400);
        vault_client.submit_request(
            &contributor,
            &recipient,
            &300i128,
            &str(&env, "Repairs"),
            &str(&env, "New month"),
            &str(&env, ""),
        );
    }

    #[test]
    fn test_recurring_contributions() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contributor = Address::generate(&env);
        let outsider = Address::generate(&env);

        let registry_address = Address::generate(&env);
        env.register_contract(&registry_address, MockRegistry);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(token_admin.clone());
        let token_info_client = soroban_sdk::token::Client::new(&env, &token_id);

        let vault_address = Address::generate(&env);
        env.register_contract(&vault_address, VaultContract);
        let vault_client = VaultContractClient::new(&env, &vault_address);

        let mut members = Vec::new(&env);
        members.push_back(contributor.clone());
        let mut roles = Vec::new(&env);
        roles.push_back(str(&env, "contributor"));

        vault_client.initialize(
            &admin,
            &token_id,
            &registry_address,
            &1u32,
            &members,
            &roles,
            &str(&env, "Team Treasury"),
            &str(&env, "Purpose"),
        );

        // Contributor funds their wallet and registers a 50/month plan
        soroban_sdk::token::StellarAssetClient::new(&env, &token_id).mint(&contributor, &500i128);
        vault_client.set_contribution_plan(&contributor, &50i128);
        let plan = vault_client.get_contribution_plan(&contributor).unwrap();
        assert_eq!(plan.amount, 50i128);
        assert!(plan.active);

        // Outsiders cannot register a plan
        let res = vault_client.try_set_contribution_plan(&outsider, &50i128);
        assert!(res.is_err());

        // Without an allowance nothing can be pulled
        assert_eq!(vault_client.run_due_contributions(), 0u32);
        assert_eq!(vault_client.get_vault_balance(), 0i128);

        // Contributor grants the vault a 2-month allowance (120 covers 50+50)
        let period_now = month_period(env.ledger().timestamp());
        token_info_client.approve(
            &contributor,
            &vault_address,
            &120i128,
            &(env.ledger().sequence() + 100_000),
        );

        // The due pull charges the plan once and records it like a deposit
        assert_eq!(vault_client.run_due_contributions(), 1u32);
        assert_eq!(vault_client.get_vault_balance(), 50i128);
        assert_eq!(vault_client.get_contribution(&contributor, &period_now), 50i128);
        assert_eq!(token_info_client.allowance(&contributor, &vault_address), 70i128);

        // Running again in the same month must not double-charge
        assert_eq!(vault_client.run_due_contributions(), 0u32);
        assert_eq!(vault_client.get_vault_balance(), 50i128);

        // Next month the plan is charged again automatically
        let ts = env.ledger().timestamp();
        env.ledger().with_mut(|li| li.timestamp = ts + 31 * 86_400);
        let period_next = month_period(env.ledger().timestamp());
        assert_ne!(period_next, period_now);
        assert_eq!(vault_client.run_due_contributions(), 1u32);
        assert_eq!(vault_client.get_vault_balance(), 100i128);
        assert_eq!(vault_client.get_contribution(&contributor, &period_next), 50i128);

        // Cancelling stops future charges even with allowance left
        vault_client.cancel_contribution_plan(&contributor);
        let ts2 = env.ledger().timestamp();
        env.ledger().with_mut(|li| li.timestamp = ts2 + 31 * 86_400);
        assert_eq!(vault_client.run_due_contributions(), 0u32);
        assert_eq!(vault_client.get_vault_balance(), 100i128);
    }
}
