import pg from 'pg';
import { PlatformTenantManager } from '../src/platform-tenant-manager.js';

const { Pool } = pg;

function printUsage() {
  console.log(`
Usage:
  node scripts/platform-cli.js create-tenant --slug <slug> --name <name> --domain <domain> [options]
  node scripts/platform-cli.js add-domain --tenant <tenantIdOrSlug> --domain <domain> [--primary]
  node scripts/platform-cli.js suspend-tenant <tenantIdOrSlug>
  node scripts/platform-cli.js activate-tenant <tenantIdOrSlug>

Options for create-tenant:
  --slug        Tenant unique slug (e.g. attar-sfax) [required]
  --name        Tenant display name (e.g. 'Attar Sfax') [required]
  --domain      Primary hostname (e.g. attar-sfax.jomla.tn) [required]
  --phone       Contact phone
  --whatsapp    Contact WhatsApp
  --min-order   Minimum order amount in millimes (integer)
  --store-name  Store branding title
  --color       Primary color hex (e.g. '#2563eb')
  --welcome     Welcome message
`);
}

function parseArgs(args) {
  const options = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        options[key] = next;
        i++;
      } else {
        options[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { command: positional[0], positional: positional.slice(1), options };
}

async function main() {
  const platformUrl = process.env.DATABASE_PLATFORM_URL;
  if (!platformUrl) {
    console.error('Error: DATABASE_PLATFORM_URL environment variable is required.');
    process.exit(1);
  }

  const { command, positional, options } = parseArgs(process.argv.slice(2));

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  const pool = new Pool({ connectionString: platformUrl });

  // Security guard: verify connection is as app_platform
  const check = await pool.query('SELECT current_user;');
  const currentUser = check.rows[0]?.current_user;
  if (currentUser !== 'app_platform') {
    console.error(`Security Violation: Platform CLI must connect as app_platform, but connected as '${currentUser}'`);
    await pool.end();
    process.exit(1);
  }

  const manager = new PlatformTenantManager(pool);

  try {
    switch (command) {
      case 'create-tenant': {
        const slug = options['slug'];
        const name = options['name'];
        const domain = options['domain'];

        if (!slug || !name || !domain) {
          console.error('Error: --slug, --name, and --domain are required for create-tenant.');
          printUsage();
          process.exit(1);
        }

        const minOrder = options['min-order'] ? BigInt(options['min-order']) : 0n;

        const result = await manager.createTenant({
          slug,
          name,
          primaryHostname: domain,
          contactPhone: options['phone'],
          contactWhatsapp: options['whatsapp'],
          minOrderAmountMillimes: minOrder,
          storeName: options['store-name'],
          primaryColor: options['color'],
          welcomeMessage: options['welcome'],
        });

        console.log('Tenant created successfully:');
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'add-domain': {
        const tenant = options['tenant'] || positional[0];
        const domain = options['domain'] || positional[1];
        const isPrimary = Boolean(options['primary']);

        if (!tenant || !domain) {
          console.error('Error: --tenant and --domain are required for add-domain.');
          printUsage();
          process.exit(1);
        }

        // Resolve tenant ID if slug provided
        let tenantId = tenant;
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenant);
        if (!isUuid) {
          const res = await pool.query('SELECT id FROM tenants WHERE slug = $1', [tenant.toLowerCase()]);
          if (res.rows.length === 0) {
            throw new Error(`Tenant not found with slug: ${tenant}`);
          }
          tenantId = res.rows[0].id;
        }

        const result = await manager.addDomain({
          tenantId,
          hostname: domain,
          kind: options['kind'] || 'custom',
          isPrimary,
        });

        console.log('Domain added successfully:');
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'suspend-tenant': {
        const tenant = positional[0] || options['tenant'] || options['slug'] || options['id'];
        if (!tenant) {
          console.error('Error: tenant ID or slug is required for suspend-tenant.');
          printUsage();
          process.exit(1);
        }

        const result = await manager.suspendTenant(tenant);
        console.log('Tenant suspended successfully:');
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'activate-tenant': {
        const tenant = positional[0] || options['tenant'] || options['slug'] || options['id'];
        if (!tenant) {
          console.error('Error: tenant ID or slug is required for activate-tenant.');
          printUsage();
          process.exit(1);
        }

        const result = await manager.activateTenant(tenant);
        console.log('Tenant activated successfully:');
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    console.error('Operation failed:', error.message || error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal CLI error:', err);
  process.exit(1);
});
