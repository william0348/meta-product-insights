import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  console.log('=== Collecting all retailer IDs that had custom_number_1 set ===\n');
  
  const allIds = new Set();
  
  // 1. Manual catalog_update jobs (retailerIds stored in config)
  console.log('--- Manual catalog_update jobs ---');
  const [manualJobs] = await conn.execute(`
    SELECT id, status, 
           JSON_LENGTH(JSON_EXTRACT(config, '$.retailerIds')) as count,
           config
    FROM batch_jobs 
    WHERE jobType = 'catalog_update' 
    AND JSON_EXTRACT(config, '$.customNumberField') = 'custom_number_1'
  `);
  
  for (const job of manualJobs) {
    const config = typeof job.config === 'string' ? JSON.parse(job.config) : job.config;
    const ids = config.retailerIds || [];
    console.log(`  Job #${job.id}: ${ids.length} IDs (status: ${job.status})`);
    ids.forEach(id => allIds.add(id));
  }
  
  // 2. Report+catalog jobs (retailerIds from saved_reports data)
  console.log('\n--- Report+catalog jobs (from saved_reports) ---');
  const [reportJobs] = await conn.execute(`
    SELECT bj.id as jobId, bj.status, bj.reportId, bj.processedItems,
           sr.id as reportId, sr.totalItems
    FROM batch_jobs bj
    LEFT JOIN saved_reports sr ON bj.reportId = sr.id
    WHERE bj.jobType = 'report_generation'
    AND JSON_EXTRACT(bj.config, '$.updateToCatalog') = true
    AND JSON_CONTAINS_PATH(bj.config, 'one', '$.customNumbers.custom_number_1')
    AND bj.status = 'completed'
    ORDER BY bj.createdAt DESC
  `);
  
  for (const job of reportJobs) {
    if (!job.reportId) {
      console.log(`  Job #${job.jobId}: No linked report (status: ${job.status})`);
      continue;
    }
    
    // Get retailer IDs from saved report data
    const [reportData] = await conn.execute(`
      SELECT data FROM saved_reports WHERE id = ? AND status = 'completed'
    `, [job.reportId]);
    
    if (reportData.length > 0 && reportData[0].data) {
      try {
        const data = JSON.parse(reportData[0].data);
        const ids = data.map(row => row.product_retailer_id).filter(Boolean);
        console.log(`  Job #${job.jobId} → Report #${job.reportId}: ${ids.length} IDs`);
        ids.forEach(id => allIds.add(id));
      } catch (e) {
        console.log(`  Job #${job.jobId} → Report #${job.reportId}: Failed to parse data`);
      }
    } else {
      console.log(`  Job #${job.jobId} → Report #${job.reportId}: No data found`);
    }
  }
  
  console.log(`\n=== Total unique retailer IDs: ${allIds.size} ===\n`);
  
  // Convert to array
  const uniqueIds = Array.from(allIds);
  console.log(`Sample IDs: ${uniqueIds.slice(0, 5).join(', ')}`);
  
  // Output the count and save to a temp file for the next step
  const fs = await import('fs');
  fs.writeFileSync('/tmp/retailer_ids_to_clear.json', JSON.stringify(uniqueIds));
  console.log(`\nSaved ${uniqueIds.length} IDs to /tmp/retailer_ids_to_clear.json`);
  
  await conn.end();
}

main().catch(console.error);
