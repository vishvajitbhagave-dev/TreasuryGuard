#![no_std]
use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, contracterror, token, Address, Env, Symbol, Vec, String, BytesN
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
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultConfig {
    pub admin: Address,
    pub token: Address,
    pub registry: Address,
    pub threshold: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpendingRequest {
    pub id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub description: String,
    pub approvals_count: u32,
    pub status: u32, // 0 = Pending, 1 = Executed, 2 = Cancelled
    pub created_at: u64,
    pub proposer: Address,
}

#[contracttype]
pub enum DataKey {
    Config,
    Members,
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
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        
        let config = VaultConfig {
            admin: admin.clone(),
            token,
            registry: registry.clone(),
            threshold,
        };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::Members, &members);
        env.storage().instance().set(&DataKey::RequestCount, &0u64);

        // Inter-contract call to register itself
        let registry_client = RegistryClient::new(&env, &registry);
        registry_client.register_vault(&env.current_contract_address());
        
        Ok(())
    }

    pub fn deposit(env: Env, from: Address, amount: i128) -> Result<(), Error> {
        from.require_auth();
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
        description: String,
    ) -> Result<u64, Error> {
        proposer.require_auth();
        
        // Verify proposer is a member
        let members: Vec<Address> = env.storage().instance().get(&DataKey::Members).unwrap();
        let mut is_member = false;
        for m in members.iter() {
            if m == proposer {
                is_member = true;
                break;
            }
        }
        if !is_member {
            return Err(Error::NotAMember);
        }

        if amount <= 0 {
            return Err(Error::AmountMustBePositive);
        }

        let mut count: u64 = env.storage().instance().get(&DataKey::RequestCount).unwrap_or(0);
        count += 1;
        env.storage().instance().set(&DataKey::RequestCount, &count);

        let request = SpendingRequest {
            id: count,
            recipient,
            amount,
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

        let members: Vec<Address> = env.storage().instance().get(&DataKey::Members).unwrap();
        let mut is_member = false;
        for m in members.iter() {
            if m == approver {
                is_member = true;
                break;
            }
        }
        if !is_member {
            return Err(Error::NotAMember);
        }

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

        let config: VaultConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        let members: Vec<Address> = env.storage().instance().get(&DataKey::Members).unwrap();
        let mut is_member = false;
        for m in members.iter() {
            if m == executor {
                is_member = true;
                break;
            }
        }
        if !is_member && executor != config.admin {
            return Err(Error::NotAuthorized);
        }

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

    pub fn get_config(env: Env) -> VaultConfig {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    pub fn get_members(env: Env) -> Vec<Address> {
        env.storage().instance().get(&DataKey::Members).unwrap_or_else(|| Vec::new(&env))
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

    #[test]
    fn test_vault_lifecycle() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
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

        vault_client.initialize(&admin, &token_id, &registry_address, &2u32, &members);

        let config = vault_client.get_config();
        assert_eq!(config.admin, admin);
        assert_eq!(config.token, token_id);
        assert_eq!(config.registry, registry_address);
        assert_eq!(config.threshold, 2);

        let stored_members = vault_client.get_members();
        assert_eq!(stored_members.len(), 2);
        assert_eq!(stored_members.get(0).unwrap(), user1);

        vault_client.deposit(&user1, &500i128);
        assert_eq!(vault_client.get_vault_balance(), 500i128);
        assert_eq!(token_info_client.balance(&user1), 500i128);

        let desc = String::from_str(&env, "Repair roof");
        let req_id = vault_client.submit_request(&user1, &recipient, &300i128, &desc);
        assert_eq!(req_id, 1);
        assert_eq!(vault_client.get_request_count(), 1);

        let request = vault_client.get_request(&1);
        assert_eq!(request.recipient, recipient);
        assert_eq!(request.amount, 300i128);
        assert_eq!(request.approvals_count, 0);
        assert_eq!(request.status, 0);

        vault_client.approve_request(&user1, &1);
        let request = vault_client.get_request(&1);
        assert_eq!(request.approvals_count, 1);
        assert!(vault_client.is_approved(&1, &user1));

        vault_client.approve_request(&user2, &1);
        let request = vault_client.get_request(&1);
        assert_eq!(request.approvals_count, 2);

        vault_client.execute_request(&user1, &1);
        
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

        vault_client.initialize(&admin, &token_id, &registry_address, &1u32, &members);

        let desc = String::from_str(&env, "Hacker attempt");
        let res = vault_client.try_submit_request(&non_member, &recipient, &100i128, &desc);
        assert!(res.is_err());
    }
}
