/**
 * Seed States and LGAs from Constants to Database
 * 
 * This script populates the states and local_governments tables
 * from the NIGERIAN_STATES constants file.
 * 
 * Usage:
 *   node scripts/seed-states-lgas.js
 * 
 * Or with environment:
 *   NODE_ENV=production node scripts/seed-states-lgas.js
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

import { getSupabaseAdmin } from '../src/config/supabase.js';
import { NIGERIAN_STATES } from '../src/constants/states.constants.js';

async function seedStatesAndLGAs() {
  console.log('🌱 Starting states and LGAs seeding...\n');
  
  const supabase = getSupabaseAdmin();
  let successCount = 0;
  let errorCount = 0;
  const errors = [];

  // Get all states from constants
  const statesArray = Object.values(NIGERIAN_STATES);
  
  console.log(`📊 Found ${statesArray.length} states to seed\n`);

  for (let index = 0; index < statesArray.length; index++) {
    const state = statesArray[index];
    
    try {
      // Insert or update state
      const { data: stateData, error: stateError } = await supabase
        .from('states')
        .upsert({
          name: state.name,
          code: state.code,
          delivery_fee: state.delivery_fee,
          is_active: true,
          display_order: index
        }, { 
          onConflict: 'code',
          ignoreDuplicates: false // Update if exists
        })
        .select()
        .single();
      
      if (stateError) {
        throw new Error(`State insert error: ${stateError.message}`);
      }
      
      if (!stateData) {
        throw new Error('State data not returned after insert');
      }
      
      // Insert or update LGAs for this state
      const lgas = state.lgas.map((lgaName, lgaIndex) => ({
        state_id: stateData.id,
        name: lgaName,
        is_active: true,
        display_order: lgaIndex
      }));
      
      // Upsert LGAs (insert or update if exists)
      const { error: lgaError } = await supabase
        .from('local_governments')
        .upsert(lgas, { 
          onConflict: 'state_id,name',
          ignoreDuplicates: false // Update if exists
        });
      
      if (lgaError) {
        throw new Error(`LGA insert error: ${lgaError.message}`);
      }
      
      successCount++;
      console.log(`✅ [${index + 1}/${statesArray.length}] ${state.name} (${state.code}) - ${state.lgas.length} LGAs`);
      
    } catch (error) {
      errorCount++;
      const errorMsg = `❌ [${index + 1}/${statesArray.length}] ${state.name}: ${error.message}`;
      errors.push(errorMsg);
      console.error(errorMsg);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📈 Seeding Summary:');
  console.log('='.repeat(60));
  console.log(`✅ Successfully seeded: ${successCount} states`);
  console.log(`❌ Errors: ${errorCount} states`);
  
  if (errors.length > 0) {
    console.log('\n❌ Errors encountered:');
    errors.forEach(err => console.log(`   ${err}`));
  }
  
  // Verify seeding
  console.log('\n🔍 Verifying database...');
  const { count: stateCount } = await supabase
    .from('states')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);
  
  const { count: lgaCount } = await supabase
    .from('local_governments')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);
  
  console.log(`📊 Database now contains:`);
  console.log(`   - ${stateCount} active states`);
  console.log(`   - ${lgaCount} active LGAs`);
  
  if (successCount === statesArray.length) {
    console.log('\n🎉 Seeding completed successfully!');
    process.exit(0);
  } else {
    console.log('\n⚠️  Seeding completed with errors. Please review the errors above.');
    process.exit(1);
  }
}

// Run the seeding
seedStatesAndLGAs().catch((error) => {
  console.error('💥 Fatal error during seeding:', error);
  process.exit(1);
});
