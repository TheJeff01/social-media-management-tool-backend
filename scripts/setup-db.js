const mongoose = require('mongoose');
const User = require('../models/User');
const SocialMediaAccount = require('../models/SocialMediaAccount');

// MongoDB connection string
const MONGODB_URI = 'mongodb://localhost:27017/social-media-app';

async function setupDatabase() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB successfully!');

    // Create indexes
    console.log('📊 Creating database indexes...');
    await User.createIndexes();
    await SocialMediaAccount.createIndexes();
    console.log('✅ Database indexes created successfully!');

    // Test creating a sample user
    console.log('👤 Testing user creation...');
    const testUser = new User({
      username: 'testuser',
      email: 'test@example.com',
      password: 'password123',
      firstName: 'Test',
      lastName: 'User'
    });

    await testUser.save();
    console.log('✅ Test user created successfully!');

    // Clean up test user
    await User.deleteOne({ email: 'test@example.com' });
    console.log('🧹 Test user cleaned up');

    console.log('\n🎉 Database setup completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Make sure MongoDB is running on localhost:27017');
    console.log('2. Create a .env file with your configuration');
    console.log('3. Start the server with: npm run dev');
    console.log('4. Test the API endpoints');

  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    console.log('\n💡 Troubleshooting:');
    console.log('1. Make sure MongoDB is installed and running');
    console.log('2. Check if MongoDB is running on localhost:27017');
    console.log('3. Try running: mongod --dbpath /path/to/data/db');
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the setup
setupDatabase();
