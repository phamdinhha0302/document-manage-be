// MongoDB initialization script
// This script runs when the MongoDB container starts for the first time

print('Starting MongoDB initialization...');

// Switch to the application database
db = db.getSiblingDB('rig_db');

// Ensure the database exists by creating a dummy collection and removing it
db.temp.insertOne({temp: true});
db.temp.drop();

print('Application database "rig_db" initialized');

// Create indexes for better performance
print('Creating indexes...');

try {
  // Users collection indexes (based on actual User schema)
  db.users.createIndex({ "email": 1 }, { unique: true, background: true });
  db.users.createIndex({ "created_at": -1 }, { background: true });
  db.users.createIndex({ "updated_at": -1 }, { background: true });
  print('Users collection indexes created');

  // News collection indexes (based on actual News schema)
  db.news.createIndex({ "slug": 1 }, { unique: true, background: true });
  db.news.createIndex({ "category": 1 }, { background: true });
  db.news.createIndex({ "is_featured": 1 }, { background: true });
  db.news.createIndex({ "published_at": -1 }, { background: true });
  db.news.createIndex({ "tags": 1 }, { background: true });
  db.news.createIndex({ "created_by": 1 }, { background: true });
  db.news.createIndex({ "created_at": -1 }, { background: true });
  print('News collection indexes created');

  // Projects collection indexes (based on actual Project schema)
  db.projects.createIndex({ "slug": 1 }, { unique: true, background: true });
  db.projects.createIndex({ "tags": 1 }, { background: true });
  db.projects.createIndex({ "location": 1 }, { background: true });

  db.projects.createIndex({ "listing_type": 1 }, { background: true });
  db.projects.createIndex({ "created_by": 1 }, { background: true });
  db.projects.createIndex({ "created_at": -1 }, { background: true });
  print('Projects collection indexes created');

  // Team members collection indexes (based on actual TeamMember schema)
  db.teammembers.createIndex({ "department": 1 }, { background: true });
  db.teammembers.createIndex({ "order": 1 }, { background: true });
  db.teammembers.createIndex({ "name": 1 }, { background: true });
  db.teammembers.createIndex({ "created_at": -1 }, { background: true });
  print('Team members collection indexes created');

  // Contacts collection indexes (based on actual Contact schema)
  db.contacts.createIndex({ "created_at": -1 }, { background: true });
  db.contacts.createIndex({ "phone": 1 }, { background: true });
  db.contacts.createIndex({ "full_name": 1 }, { background: true });
  print('Contacts collection indexes created');

  // Amenities collection indexes (based on actual Amenity schema)
  db.amenities.createIndex({ "title": 1 }, { background: true });
  db.amenities.createIndex({ "created_at": -1 }, { background: true });
  print('Amenities collection indexes created');

  // Icons collection indexes (based on actual Icon schema)
  db.icons.createIndex({ "name": 1 }, { unique: true, background: true });
  db.icons.createIndex({ "created_at": -1 }, { background: true });
  print('Icons collection indexes created');

} catch (error) {
  print('Error creating indexes: ' + error);
}

print('MongoDB initialization completed successfully!');