// test/integration/teardown.ts

import { execSync } from 'child_process';

module.exports = async () => {
  console.log('\n🧹 Stopping test database...');

  execSync('docker-compose -f docker-compose.test.yml down -v', {
    stdio: 'inherit',
  });

  console.log('✅ Test database stopped');
};
