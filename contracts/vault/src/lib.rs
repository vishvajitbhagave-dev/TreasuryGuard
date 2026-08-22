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
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpendingRules {
    pub max_request_amount: i128,
    pub blocked_categories: Vec<String>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpendingRequest {
    pub id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub category: String,
    pub description: String,
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
    Request(u64),
    Approved(u64, Address),
    RequestCount,
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
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::require_role(&env, &caller, &[Role::Owner])?;

        let rules = SpendingRules {
            max_request_amount,
            blocked_categories,
        };
        env.storage().instance().set(&DataKey::Rules, &rules);
        Ok(())
    }

    pub fn get_rules(env: Env) -> SpendingRules {
        env.storage().instance().get(&DataKey::Rules).unwrap_or_else(|| SpendingRules {
            max_request_amount: 0,
            blocked_categories: Vec::new(&env),
        })
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
        );
        assert_eq!(req_id, 1);
        assert_eq!(vault_client.get_request_count(), 1);

        let request = vault_client.get_request(&1);
        assert_eq!(request.recipient, recipient);
        assert_eq!(request.amount, 300i128);
        assert_eq!(request.category, str(&env, "Operations"));
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
        let res = vault_client.try_set_rules(&contributor, &1000i128, &blocked);
        assert!(res.is_err());

        // Owner sets a per-request limit and a restricted category
        vault_client.set_rules(&admin, &1000i128, &blocked);
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
        );
        assert_eq!(ok_id, 1);

        // Oversized request is rejected
        let res = vault_client.try_submit_request(
            &contributor,
            &recipient,
            &2000i128,
            &str(&env, "Operations"),
            &str(&env, "Over limit"),
        );
        assert!(res.is_err());

        // Restricted category is rejected
        let res = vault_client.try_submit_request(
            &contributor,
            &recipient,
            &100i128,
            &str(&env, "Marketing"),
            &str(&env, "Blocked category"),
        );
        assert!(res.is_err());
    }
}
