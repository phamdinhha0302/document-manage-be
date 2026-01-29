/**
 * Migration script to populate Vietnamese search fields for existing documents
 * Run this script once to update all existing documents with de-accented search fields
 * 
 * Usage: node src/migrations/add-vietnamese-search-fields.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { normalizeSearchText } = require('../utils');

// Connect to MongoDB
const mongoUri = process.env.MONGODB_URI || 'mongodb://admin:admin123@localhost:27018/doc_db?authSource=admin';

async function migrate() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Get Document model
    const Document = require('../schemas/document.schema');

    // Find all documents
    const documents = await Document.find({});
    console.log(`📄 Found ${documents.length} documents to update`);

    let updated = 0;
    let errors = 0;

    for (const doc of documents) {
      try {
        // Update search fields
        doc.titleSearch = normalizeSearchText(doc.title || '');
        doc.descriptionSearch = normalizeSearchText(doc.description || '');
        doc.fileNameSearch = normalizeSearchText(doc.fileName || '');
        doc.ocrContentSearch = normalizeSearchText(doc.ocrContent || '');

        await doc.save();
        updated++;
        
        if (updated % 100 === 0) {
          console.log(`⏳ Updated ${updated}/${documents.length} documents...`);
        }
      } catch (err) {
        console.error(`❌ Error updating document ${doc._id}:`, err.message);
        errors++;
      }
    }

    console.log(`\n✅ Migration completed!`);
    console.log(`   - Updated: ${updated} documents`);
    console.log(`   - Errors: ${errors} documents`);

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

migrate();
