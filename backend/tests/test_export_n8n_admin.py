"""
Tests for N8N exports, Word/PDF reports, and Admin divisions functionality
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_CREDS = {"email": "admin@bpscanner.ru", "password": "admin123"}
USER_CREDS = {"email": "test_analysis@test.ru", "password": "test123"}
DIVISION_ID = "aec367c0-a274-4148-ab8c-ddf5aaa97c40"  # Completed division


@pytest.fixture(scope="module")
def admin_token():
    """Get admin token for authentication"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
    if resp.status_code == 200:
        return resp.json().get("token")
    pytest.skip(f"Admin login failed: {resp.status_code} - {resp.text}")


@pytest.fixture(scope="module")
def user_token():
    """Get user token for authentication"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json=USER_CREDS)
    if resp.status_code == 200:
        return resp.json().get("token")
    pytest.skip(f"User login failed: {resp.status_code} - {resp.text}")


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def user_headers(user_token):
    return {"Authorization": f"Bearer {user_token}", "Content-Type": "application/json"}


class TestAuthenticationBasics:
    """Test authentication endpoints"""
    
    def test_admin_login(self):
        """Admin should be able to login"""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        assert resp.status_code == 200, f"Admin login failed: {resp.text}"
        data = resp.json()
        assert "token" in data
        assert "user" in data
        print(f"✓ Admin login successful, user: {data['user']}")
    
    def test_user_login(self):
        """User should be able to login"""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=USER_CREDS)
        assert resp.status_code == 200, f"User login failed: {resp.text}"
        data = resp.json()
        assert "token" in data
        print(f"✓ User login successful")
    
    def test_admin_check(self, admin_headers):
        """Check if admin user has admin role"""
        resp = requests.get(f"{BASE_URL}/api/auth/check-admin", headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("is_admin") == True, f"Admin user should have admin role: {data}"
        print(f"✓ Admin check passed: {data}")


class TestN8NWorkflows:
    """Test N8N workflow retrieval for JSON export"""
    
    def test_get_n8n_workflows(self, user_headers):
        """Get N8N workflows for the completed division"""
        resp = requests.get(f"{BASE_URL}/api/divisions/{DIVISION_ID}/n8n", headers=user_headers)
        assert resp.status_code == 200, f"N8N fetch failed: {resp.status_code} - {resp.text}"
        data = resp.json()
        assert isinstance(data, list), "N8N response should be a list"
        print(f"✓ N8N workflows retrieved: {len(data)} workflows")
        
        # Check workflow structure for proper JSON export
        if len(data) > 0:
            wf = data[0]
            assert "name" in wf, "Workflow should have name"
            assert "nodes" in wf, "Workflow should have nodes"
            assert isinstance(wf["nodes"], list), "Nodes should be a list"
            print(f"✓ First workflow: {wf['name']} with {len(wf.get('nodes', []))} nodes")


class TestExportReports:
    """Test Word and PDF report exports"""
    
    def test_export_word(self, user_headers):
        """Export Word report should return .docx file"""
        resp = requests.get(
            f"{BASE_URL}/api/divisions/{DIVISION_ID}/export/word",
            headers=user_headers
        )
        assert resp.status_code == 200, f"Word export failed: {resp.status_code} - {resp.text}"
        
        # Check content type
        content_type = resp.headers.get("content-type", "")
        assert "application/vnd.openxmlformats-officedocument.wordprocessingml.document" in content_type or \
               "application/octet-stream" in content_type, \
               f"Expected Word content type, got: {content_type}"
        
        # Check content disposition has filename
        content_disp = resp.headers.get("content-disposition", "")
        assert "attachment" in content_disp, f"Expected attachment, got: {content_disp}"
        assert ".docx" in content_disp, f"Expected .docx filename, got: {content_disp}"
        
        # Check content is not empty
        assert len(resp.content) > 1000, f"Word file too small: {len(resp.content)} bytes"
        
        print(f"✓ Word export successful: {len(resp.content)} bytes")
        print(f"  Content-Disposition: {content_disp}")
    
    def test_export_pdf(self, user_headers):
        """Export PDF report should return .pdf file"""
        resp = requests.get(
            f"{BASE_URL}/api/divisions/{DIVISION_ID}/export/pdf",
            headers=user_headers
        )
        assert resp.status_code == 200, f"PDF export failed: {resp.status_code} - {resp.text}"
        
        # Check content type
        content_type = resp.headers.get("content-type", "")
        assert "application/pdf" in content_type or "application/octet-stream" in content_type, \
               f"Expected PDF content type, got: {content_type}"
        
        # Check content disposition has filename
        content_disp = resp.headers.get("content-disposition", "")
        assert "attachment" in content_disp, f"Expected attachment, got: {content_disp}"
        
        # Check content is not empty (PDF should be at least a few KB)
        assert len(resp.content) > 1000, f"PDF file too small: {len(resp.content)} bytes"
        
        # Check PDF magic bytes
        assert resp.content[:4] == b'%PDF', f"Invalid PDF header"
        
        print(f"✓ PDF export successful: {len(resp.content)} bytes")
        print(f"  Content-Disposition: {content_disp}")


class TestAdminDivisions:
    """Test admin panel divisions endpoints"""
    
    def test_get_admin_divisions(self, admin_headers):
        """Admin should be able to get all divisions"""
        resp = requests.get(f"{BASE_URL}/api/admin/divisions", headers=admin_headers)
        assert resp.status_code == 200, f"Admin divisions failed: {resp.status_code} - {resp.text}"
        data = resp.json()
        assert isinstance(data, list), "Should return list of divisions"
        print(f"✓ Admin divisions retrieved: {len(data)} divisions")
        
        # Check division structure
        if len(data) > 0:
            div = data[0]
            assert "id" in div, "Division should have id"
            assert "name" in div, "Division should have name"
            print(f"✓ First division: {div.get('name')} (status: {div.get('analysis_status')})")
    
    def test_get_division_questionnaire_admin(self, admin_headers):
        """Admin should get questionnaire for a division"""
        resp = requests.get(
            f"{BASE_URL}/api/admin/divisions/{DIVISION_ID}/questionnaire",
            headers=admin_headers
        )
        assert resp.status_code == 200, f"Admin questionnaire failed: {resp.status_code} - {resp.text}"
        data = resp.json()
        assert "answers" in data, "Should have answers field"
        print(f"✓ Admin questionnaire retrieved, answers keys: {list(data.get('answers', {}).keys())}")
    
    def test_get_division_documents_admin(self, admin_headers):
        """Admin should get documents for a division"""
        resp = requests.get(
            f"{BASE_URL}/api/admin/divisions/{DIVISION_ID}/documents",
            headers=admin_headers
        )
        assert resp.status_code == 200, f"Admin documents failed: {resp.status_code} - {resp.text}"
        data = resp.json()
        assert isinstance(data, list), "Should return list of documents"
        print(f"✓ Admin documents retrieved: {len(data)} documents")
    
    def test_non_admin_cannot_access_admin_endpoints(self, user_headers):
        """Regular user should not access admin endpoints"""
        resp = requests.get(f"{BASE_URL}/api/admin/divisions", headers=user_headers)
        assert resp.status_code == 403, f"Non-admin should get 403, got: {resp.status_code}"
        print(f"✓ Non-admin correctly denied access: {resp.status_code}")


class TestDivisionData:
    """Test data availability for the completed division"""
    
    def test_division_exists(self, user_headers):
        """The test division should exist"""
        resp = requests.get(f"{BASE_URL}/api/divisions/{DIVISION_ID}", headers=user_headers)
        assert resp.status_code == 200, f"Division not found: {resp.status_code}"
        data = resp.json()
        print(f"✓ Division found: {data.get('name')} (status: {data.get('analysis_status')})")
    
    def test_division_has_processes(self, user_headers):
        """Division should have analyzed processes"""
        resp = requests.get(f"{BASE_URL}/api/divisions/{DIVISION_ID}/processes", headers=user_headers)
        assert resp.status_code == 200
        data = resp.json()
        print(f"✓ Processes: {len(data)}")
    
    def test_division_has_recommendations(self, user_headers):
        """Division should have recommendations"""
        resp = requests.get(f"{BASE_URL}/api/divisions/{DIVISION_ID}/recommendations", headers=user_headers)
        assert resp.status_code == 200
        data = resp.json()
        print(f"✓ Recommendations: {len(data)}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
