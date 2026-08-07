#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, contracterror, Address, Env, Symbol, Vec, BytesN};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
}

#[contracttype]
pub enum DataKey {
    Vaults,          // Vec<Address>
    ActivityCount,   // u64
    Admin,           // Address
}

#[contract]
pub struct VaultRegistry;

#[contractimpl]
impl VaultRegistry {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Vaults, &Vec::<Address>::new(&env));
        env.storage().instance().set(&DataKey::ActivityCount, &0u64);
        Ok(())
    }

    pub fn register_vault(env: Env, vault: Address) {
        let mut vaults: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Vaults)
            .unwrap_or_else(|| Vec::new(&env));
        
        let mut exists = false;
        for v in vaults.iter() {
            if v == vault {
                exists = true;
                break;
            }
        }
        
        if !exists {
            vaults.push_back(vault.clone());
            env.storage().instance().set(&DataKey::Vaults, &vaults);
            env.events().publish((Symbol::new(&env, "vault_registered"),), vault);
        }
    }

    pub fn log_activity(env: Env, user: Address, activity_type: Symbol) {
        let count: u64 = env.storage().instance().get(&DataKey::ActivityCount).unwrap_or(0);
        env.storage().instance().set(&DataKey::ActivityCount, &(count + 1));
        env.events().publish((Symbol::new(&env, "activity_logged"), activity_type), user);
    }

    pub fn get_vaults(env: Env) -> Vec<Address> {
        env.storage().instance().get(&DataKey::Vaults).unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_activity_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::ActivityCount).unwrap_or(0)
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{Env, Address, Symbol};
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_registry_lifecycle() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let registry_address = Address::generate(&env);
        env.register_contract(&registry_address, VaultRegistry);
        let client = VaultRegistryClient::new(&env, &registry_address);

        // Initialize
        client.initialize(&admin);

        // Register vault
        let vault_address = Address::generate(&env);
        client.register_vault(&vault_address);

        let vaults = client.get_vaults();
        assert_eq!(vaults.len(), 1);
        assert_eq!(vaults.get(0).unwrap(), vault_address);

        // Log activity
        let user = Address::generate(&env);
        client.log_activity(&user, &Symbol::new(&env, "deposit"));
        assert_eq!(client.get_activity_count(), 1);
    }
}
