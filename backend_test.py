import requests
import sys
import json
import uuid
from datetime import datetime

class BusinessProcessAPITester:
    def __init__(self, base_url="https://process-analyzer-3.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.token = None
        self.test_user = None
        self.test_division_id = None
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []

    def log(self, message, success=True):
        symbol = "✅" if success else "❌"
        print(f"{symbol} {message}")
        if not success:
            self.failed_tests.append(message)

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.base_url}{endpoint}"
        test_headers = {'Content-Type': 'application/json'}
        
        if self.token:
            test_headers['Authorization'] = f'Bearer {self.token}'
        
        if headers:
            test_headers.update(headers)

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=test_headers)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=test_headers)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=test_headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=test_headers)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                self.log(f"{name} - Status: {response.status_code}", True)
                
                # Try to parse JSON response
                try:
                    return True, response.json()
                except:
                    return True, {"status": "success"}
            else:
                self.log(f"{name} - Expected {expected_status}, got {response.status_code}. Response: {response.text[:200]}", False)
                return False, {}

        except Exception as e:
            self.log(f"{name} - Network Error: {str(e)}", False)
            return False, {}

    def test_user_registration(self):
        """Test user registration"""
        print("\n=== TESTING USER REGISTRATION ===")
        test_email = f"testuser_{uuid.uuid4().hex[:8]}@test.com"
        test_data = {
            "email": test_email,
            "password": "test123",
            "name": "Test User"
        }
        
        success, response = self.run_test(
            "User Registration",
            "POST",
            "/auth/register",
            200,
            test_data
        )
        
        if success and 'token' in response:
            self.token = response['token']
            self.test_user = response['user']
            self.log(f"Registration successful. User ID: {self.test_user.get('id')}", True)
            return True
        else:
            self.log("Registration failed - no token returned", False)
            return False

    def test_user_login(self):
        """Test user login with existing test user"""
        print("\n=== TESTING USER LOGIN ===")
        
        login_data = {
            "email": "test@test.com",
            "password": "test123"
        }
        
        success, response = self.run_test(
            "User Login",
            "POST",
            "/auth/login",
            200,
            login_data
        )
        
        if success and 'token' in response:
            self.token = response['token']
            self.test_user = response['user']
            self.log(f"Login successful. User ID: {self.test_user.get('id')}", True)
            return True
        else:
            self.log("Login failed - no token returned", False)
            return False

    def test_get_user_info(self):
        """Test GET /auth/me"""
        print("\n=== TESTING USER INFO ===")
        
        success, response = self.run_test(
            "Get User Info",
            "GET",
            "/auth/me",
            200
        )
        
        if success and response.get('email'):
            self.log(f"User info retrieved. Email: {response.get('email')}", True)
            return True
        else:
            self.log("Failed to retrieve user info", False)
            return False

    def test_division_operations(self):
        """Test division CRUD operations"""
        print("\n=== TESTING DIVISION OPERATIONS ===")
        
        # Create Division
        division_data = {
            "name": f"Test Division {uuid.uuid4().hex[:6]}",
            "description": "Test division for API testing",
            "head_name": "Test Manager",
            "employees_count": 25
        }
        
        success, response = self.run_test(
            "Create Division",
            "POST",
            "/divisions",
            200,
            division_data
        )
        
        if success and response.get('id'):
            self.test_division_id = response['id']
            self.log(f"Division created. ID: {self.test_division_id}", True)
        else:
            self.log("Failed to create division", False)
            return False

        # List Divisions
        success, response = self.run_test(
            "List Divisions",
            "GET",
            "/divisions",
            200
        )
        
        if success and isinstance(response, list):
            self.log(f"Listed divisions. Count: {len(response)}", True)
        else:
            self.log("Failed to list divisions", False)

        # Get Division Detail
        if self.test_division_id:
            success, response = self.run_test(
                "Get Division Detail",
                "GET",
                f"/divisions/{self.test_division_id}",
                200
            )
            
            if success and response.get('id') == self.test_division_id:
                self.log(f"Division detail retrieved. Name: {response.get('name')}", True)
            else:
                self.log("Failed to get division detail", False)

        return True

    def test_questionnaire_operations(self):
        """Test questionnaire operations"""
        print("\n=== TESTING QUESTIONNAIRE OPERATIONS ===")
        
        if not self.test_division_id:
            self.log("No test division available for questionnaire tests", False)
            return False

        # Get Questionnaire Schema
        success, response = self.run_test(
            "Get Questionnaire Schema",
            "GET",
            "/questionnaire/schema",
            200
        )
        
        if success and isinstance(response, list):
            self.log(f"Questionnaire schema retrieved. Sections: {len(response)}", True)
        else:
            self.log("Failed to get questionnaire schema", False)

        # Save Questionnaire Answers
        test_answers = {
            "dept_function": "Test department function",
            "employees_roles": "Test roles",
            "top_processes": "1. Process 1\n2. Process 2\n3. Process 3"
        }
        
        success, response = self.run_test(
            "Save Questionnaire",
            "POST",
            f"/divisions/{self.test_division_id}/questionnaire",
            200,
            {"answers": test_answers}
        )
        
        if success:
            self.log("Questionnaire saved successfully", True)
        else:
            self.log("Failed to save questionnaire", False)

        # Get Questionnaire Answers
        success, response = self.run_test(
            "Get Questionnaire",
            "GET",
            f"/divisions/{self.test_division_id}/questionnaire",
            200
        )
        
        if success:
            self.log("Questionnaire retrieved successfully", True)
        else:
            self.log("Failed to retrieve questionnaire", False)

        return True

    def test_document_operations(self):
        """Test document operations"""
        print("\n=== TESTING DOCUMENT OPERATIONS ===")
        
        if not self.test_division_id:
            self.log("No test division available for document tests", False)
            return False

        # Test listing documents (should be empty initially)
        success, response = self.run_test(
            "List Documents",
            "GET",
            f"/divisions/{self.test_division_id}/documents",
            200
        )
        
        if success and isinstance(response, list):
            self.log(f"Document list retrieved. Count: {len(response)}", True)
        else:
            self.log("Failed to list documents", False)

        return True

    def test_analysis_operations(self):
        """Test analysis operations (without actually running full analysis)"""
        print("\n=== TESTING ANALYSIS OPERATIONS ===")
        
        if not self.test_division_id:
            self.log("No test division available for analysis tests", False)
            return False

        # Get Analysis Status
        success, response = self.run_test(
            "Get Analysis Status",
            "GET",
            f"/divisions/{self.test_division_id}/analysis-status",
            200
        )
        
        if success and 'status' in response:
            self.log(f"Analysis status retrieved. Status: {response.get('status')}", True)
        else:
            self.log("Failed to get analysis status", False)

        # Test starting analysis (this will actually start but we won't wait)
        success, response = self.run_test(
            "Start Analysis",
            "POST",
            f"/divisions/{self.test_division_id}/analyze",
            200
        )
        
        if success:
            self.log("Analysis started successfully", True)
        else:
            self.log("Failed to start analysis", False)

        return True

    def test_dashboard(self):
        """Test dashboard endpoint"""
        print("\n=== TESTING DASHBOARD ===")
        
        success, response = self.run_test(
            "Get Dashboard",
            "GET",
            "/dashboard",
            200
        )
        
        if success and 'total_divisions' in response:
            self.log(f"Dashboard data retrieved. Total divisions: {response.get('total_divisions')}", True)
            return True
        else:
            self.log("Failed to get dashboard data", False)
            return False

    def cleanup(self):
        """Clean up test data"""
        print("\n=== CLEANUP ===")
        
        if self.test_division_id:
            success, response = self.run_test(
                "Delete Test Division",
                "DELETE",
                f"/divisions/{self.test_division_id}",
                200
            )
            
            if success:
                self.log("Test division deleted successfully", True)
            else:
                self.log("Failed to delete test division", False)

    def run_all_tests(self):
        """Run all API tests"""
        print("🚀 Starting Business Process Scanner API Tests")
        print(f"📍 Testing endpoint: {self.base_url}")
        print("=" * 60)

        # Test authentication first with existing user
        if not self.test_user_login():
            print("\n❌ Login failed, trying registration...")
            if not self.test_user_registration():
                print("❌ Both login and registration failed. Cannot proceed.")
                return False

        # Test user info
        self.test_get_user_info()

        # Test all other operations
        self.test_division_operations()
        self.test_questionnaire_operations()
        self.test_document_operations()
        self.test_dashboard()
        self.test_analysis_operations()

        # Cleanup
        self.cleanup()

        # Print summary
        print("\n" + "=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        print(f"Total Tests: {self.tests_run}")
        print(f"Passed: {self.tests_passed}")
        print(f"Failed: {self.tests_run - self.tests_passed}")
        print(f"Success Rate: {(self.tests_passed/self.tests_run)*100:.1f}%")
        
        if self.failed_tests:
            print("\n❌ Failed Tests:")
            for test in self.failed_tests:
                print(f"   • {test}")

        return self.tests_passed == self.tests_run

def main():
    tester = BusinessProcessAPITester()
    success = tester.run_all_tests()
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())