// test/integration/setup.ts

import { execSync } from 'child_process';

module.exports = async () => {
  console.log('\n🐳 Starting test database...');

  execSync('docker-compose -f docker-compose.test.yml up -d postgres-test', {
    stdio: 'inherit',
  });

  // Wait for postgres to be healthy
  let attempts = 0;
  while (attempts < 20) {
    try {
      execSync('docker exec payflow-postgres-test pg_isready -U postgres', {
        stdio: 'pipe',
      });
      break;
    } catch {
      attempts++;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log('✅ Test database ready');
};
