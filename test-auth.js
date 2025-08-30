const axios = require('axios');

const BASE_URL = 'http://localhost:3001';

async function testAuth() {
  console.log('🧪 Testing Authentication Endpoints...\n');

  try {
    // Test 1: Register a new user
    console.log('1. Testing user registration...');
    try {
      const registerResponse = await axios.post(`${BASE_URL}/auth/register`, {
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User'
      });

      console.log('✅ Registration successful:', registerResponse.data.message);
      console.log('   User ID:', registerResponse.data.user._id);
      console.log('   Token received:', !!registerResponse.data.token);
    } catch (error) {
      if (error.response && error.response.data.error === 'User already exists') {
        console.log('ℹ️  User already exists (this is expected if test was run before)');
      } else {
        console.log('❌ Registration failed:', error.response?.data?.message || error.message);
      }
    }

    // Test 2: Login with the user
    console.log('\n2. Testing user login...');
    try {
      const loginResponse = await axios.post(`${BASE_URL}/auth/login`, {
        email: 'test@example.com',
        password: 'password123'
      });

      console.log('✅ Login successful:', loginResponse.data.message);
      console.log('   User:', loginResponse.data.user.username);
      console.log('   Token received:', !!loginResponse.data.token);
      
      const token = loginResponse.data.token;
      
      // Test 3: Test protected endpoint
      console.log('\n3. Testing protected endpoint...');
      try {
        const protectedResponse = await axios.get(`${BASE_URL}/auth/profile`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          }
        });

        console.log('✅ Protected endpoint accessible:', protectedResponse.data.message);
      } catch (error) {
        console.log('❌ Protected endpoint failed:', error.response?.data?.message || error.message);
      }

      // Test 4: Test logout
      console.log('\n4. Testing logout...');
      try {
        const logoutResponse = await axios.post(`${BASE_URL}/auth/logout`, {}, {
          headers: {
            'Authorization': `Bearer ${token}`,
          }
        });

        console.log('✅ Logout successful:', logoutResponse.data.message);
      } catch (error) {
        console.log('❌ Logout failed:', error.response?.data?.message || error.message);
      }

    } catch (error) {
      console.log('❌ Login failed:', error.response?.data?.message || error.message);
    }

    console.log('\n🎉 Authentication tests completed!');

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

// Run the test
testAuth();
