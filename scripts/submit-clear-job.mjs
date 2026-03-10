import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  // Load the retailer IDs
  const retailerIds = JSON.parse(fs.readFileSync('/tmp/retailer_ids_to_clear.json', 'utf8'));
  console.log(`Loaded ${retailerIds.length} unique retailer IDs to clear`);
  
  // Get the catalog token and catalog ID
  const [tokens] = await conn.execute(`
    SELECT accessToken, catalogId FROM user_tokens WHERE tokenType = 'catalog_management' ORDER BY updatedAt DESC LIMIT 1
  `);
  
  if (tokens.length === 0) {
    console.error('No catalog token found!');
    await conn.end();
    return;
  }
  
  const { accessToken, catalogId } = tokens[0];
  console.log(`Catalog ID: ${catalogId}`);
  console.log(`Token: ${accessToken.substring(0, 20)}...`);
  
  // Get the user ID (owner)
  const [users] = await conn.execute(`SELECT id FROM users ORDER BY id ASC LIMIT 1`);
  const userId = users[0]?.id || 1;
  console.log(`User ID: ${userId}`);
  
  // Build the job config
  const config = {
    catalogId,
    accessToken,
    retailerIds,
    customNumberField: 'custom_number_1',
    customNumberValue: '0',
    updateCriteria: {
      targetField: 'custom_number_1',
      condition: 'overwrite',
      description: `Clear custom_number_1 to 0 for ${retailerIds.length} products (undo previous 6666 uploads)`,
    },
  };
  
  // Insert the job
  const [result] = await conn.execute(`
    INSERT INTO batch_jobs (userId, jobType, config, status, progress, currentBatch, totalBatches, processedItems, totalItems, successCount, errorCount, warningCount, queuedAt, createdAt, updatedAt)
    VALUES (?, 'catalog_update', ?, 'queued', 0, 0, 0, 0, ?, 0, 0, 0, NOW(), NOW(), NOW())
  `, [userId, JSON.stringify(config), retailerIds.length]);
  
  console.log(`\n✅ Job submitted successfully!`);
  console.log(`Job ID: ${result.insertId}`);
  console.log(`Total items: ${retailerIds.length}`);
  console.log(`Action: Set custom_number_1 = 0`);
  console.log(`\nThe background job processor will pick this up within 5 seconds.`);
  console.log(`You can monitor progress in the Reports page.`);
  
  await conn.end();
}

main().catch(console.error);
