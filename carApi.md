# Cars API Documentation

## Overview

The Cars API manages vehicle registration and related data. It provides CRUD operations with support for both private and commercial vehicles, including plate number applications and registration status tracking.

**Key Behaviors:**
- User-scoped access: users can only access their own cars
- Soft delete: deleted cars are marked with `deleted_at` timestamp
- Global uniqueness enforcement on vehicle identifiers
- Conditional validation based on registration status and plate type

**Scope:**
- Basic CRUD operations
- Pagination support
- Duplicate prevention for registration, chassis, and engine numbers

## Base URL

**Base Path:** `/api`

All Cars API endpoints are prefixed with `/api`.

## Authentication

All endpoints require authentication via Bearer token.

**Header:**
```
Authorization: Bearer <supabase_jwt_token>
```

**Unauthenticated Requests:**
- Status: `401 Unauthorized`
- Response: Standard error object

**Email Verification:**
All endpoints require the authenticated user to have a verified email address. Unverified users will receive a `403` error.

## Data Model

### Car Object

| Field | Type | Description | Category |
|-------|------|-------------|----------|
| `id` | integer | Auto-incrementing primary key | Server-controlled |
| `slug` | UUID | Unique identifier for URL access | Server-controlled |
| `user_id` | UUID | Owner of the car | Server-controlled |
| `name_of_owner` | string (max 100) | Full name of the owner | Required |
| `phone_number` | string (max 20) | Contact phone number | Optional |
| `address` | string (max 500) | Owner's address | Required |
| `vehicle_make` | string (max 50) | Vehicle manufacturer | Required |
| `vehicle_model` | string (max 50) | Vehicle model | Required |
| `vehicle_year` | integer | Year of manufacture (1900-2027) | Required |
| `vehicle_color` | string (max 30) | Vehicle color | Required |
| `car_type` | enum | `private` or `commercial` | Required |
| `registration_status` | enum | `registered` or `unregistered` | Required |
| `status` | enum | `unpaid`, `pending`, `approved`, `rejected` | Server-controlled (default: `unpaid`) |
| `registration_no` | string (max 20) | Registration number | Optional |
| `chasis_no` | string (max 30) | Chassis number | Optional |
| `engine_no` | string (max 30) | Engine number | Optional |
| `date_issued` | date (ISO 8601) | Registration issue date | Conditional* |
| `expiry_date` | date (ISO 8601) | Registration expiry date | Conditional* |
| `document_images` | array (max 10 URLs) | Vehicle document images | Optional |
| `plate_number` | string (max 20) | License plate number | Optional |
| `type` | enum | Plate type: `Normal`, `Customized`, `Dealership` | Optional |
| `preferred_name` | string (max 100) | Preferred name for customized plates | Optional |
| `business_type` | string (max 50) | Type of business | Optional |
| `cac_document` | string (URL) | Corporate Affairs Commission document | Optional |
| `letterhead` | string (URL) | Company letterhead document | Optional |
| `means_of_identification` | string (URL) | ID document | Optional |
| `company_name` | string (max 100) | Company name | Conditional** |
| `company_address` | string (max 500) | Company address | Conditional** |
| `company_phone` | string (max 20) | Company phone number | Conditional** |
| `cac_number` | string (max 50) | CAC registration number | Conditional** |
| `created_at` | timestamp (ISO 8601) | Creation timestamp | Server-controlled |
| `updated_at` | timestamp (ISO 8601) | Last update timestamp | Server-controlled |
| `deleted_at` | timestamp (ISO 8601) | Soft delete timestamp (null if active) | Server-controlled |

**\*Conditional on `registration_status`:** Required when `registration_status` is `registered`, optional when `unregistered`.

**\*\*Conditional on `type`:** Required when `type` is `Dealership`, optional otherwise.

## Constraints & Business Rules

### Uniqueness Constraints

The following fields must be globally unique across all active (non-deleted) cars:
- `registration_no` (when not null)
- `chasis_no` (when not null)
- `engine_no` (when not null)

Attempting to create or update a car with a duplicate value results in a `409 Conflict` response.

### Soft Delete Behavior

DELETE operations set `deleted_at` to the current timestamp. The car is not physically removed from the database.

- Deleted cars are excluded from all queries
- Unique constraints do not apply to deleted cars
- Slug values from deleted cars can be reused (soft-deleted cars are not accessible)

### Ownership Rules

Users can only access their own cars. Attempting to access another user's car results in a `404 Not Found` response (not `403` to prevent user enumeration).

### Date Validation

For registered cars (`registration_status: registered`):
- `date_issued` must be provided
- `expiry_date` must be provided and must be after `date_issued`

### Document Uploads

The API supports two methods for providing documents:

1. **File Upload (Recommended)**: Upload files directly using `multipart/form-data`
2. **URL (Backward Compatible)**: Provide URLs using `application/json`

**File Upload Fields:**
- `document_images`: Array of image files (max 10 files, 5MB each)
- `cac_document`: Single document file (max 10MB)
- `letterhead`: Single document file (max 10MB)
- `means_of_identification`: Single document file (max 10MB)

**Allowed File Types:**
- Images: `jpg`, `jpeg`, `png`, `webp` (for `document_images`)
- Documents: `pdf`, `jpg`, `jpeg`, `png` (for `cac_document`, `letterhead`, `means_of_identification`)

**File Size Limits:**
- Images: 5MB per file
- Documents: 10MB per file

**Security Validations:**
- File type validation (MIME type and file signature)
- File size limits enforced
- Dangerous file extensions rejected
- Double extension detection
- File content signature verification

**URL Fields (Backward Compatible):**
When using `application/json`, all document fields (`document_images`, `cac_document`, `letterhead`, `means_of_identification`) must be valid HTTP/HTTPS URLs (max 2048 characters).

## Endpoints

### POST /api/reg-car

Register a new car.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: multipart/form-data  # For file uploads
# OR
Content-Type: application/json     # For URL-based submissions (backward compatible)
```

**Request Body (multipart/form-data with file uploads):**

```
name_of_owner: "John Doe"
phone_number: "+2348012345678"
address: "123 Main Street, Lagos"
vehicle_make: "Toyota"
vehicle_model: "Camry"
vehicle_year: 2020
vehicle_color: "Blue"
car_type: "private"
registration_status: "registered"
registration_no: "ABC123XY"
chasis_no: "1HGBH41JXMN109186"
engine_no: "4G63T123456"
date_issued: "2020-05-15"
expiry_date: "2025-05-15"
document_images: [file1.jpg, file2.png]  # Up to 10 files
plate_number: "LAG-123-ABC"
type: "Normal"
```

**Request Body (application/json with URLs - backward compatible):**

```json
{
  "name_of_owner": "John Doe",
  "phone_number": "+2348012345678",
  "address": "123 Main Street, Lagos",
  "vehicle_make": "Toyota",
  "vehicle_model": "Camry",
  "vehicle_year": 2020,
  "vehicle_color": "Blue",
  "car_type": "private",
  "registration_status": "registered",
  "registration_no": "ABC123XY",
  "chasis_no": "1HGBH41JXMN109186",
  "engine_no": "4G63T123456",
  "date_issued": "2020-05-15",
  "expiry_date": "2025-05-15",
  "document_images": ["https://example.com/doc1.jpg"],
  "plate_number": "LAG-123-ABC",
  "type": "Normal"
}
```

**Validation Rules:**
- `name_of_owner`: 2-100 characters
- `address`: 5-500 characters
- `phone_number`: valid phone number format (optional)
- `vehicle_make`, `vehicle_model`: 1-50 characters
- `vehicle_year`: 1900 to current year + 1
- `vehicle_color`: 2-30 characters
- `car_type`: `private` or `commercial`
- `registration_status`: `registered` or `unregistered`
- `registration_no`: 1-20 characters (optional)
- `chasis_no`: 1-30 characters (optional)
- `engine_no`: 1-30 characters (optional)
- `date_issued`, `expiry_date`: required if `registration_status` is `registered`
- `document_images`: 
  - File upload: array of up to 10 image files (5MB each, jpg/jpeg/png/webp)
  - URL: array of up to 10 valid HTTP/HTTPS URLs
- `type`: `Normal`, `Customized`, or `Dealership` (optional)
- `cac_document`, `letterhead`, `means_of_identification`:
  - File upload: single document file (10MB max, pdf/jpg/jpeg/png)
  - URL: valid HTTP/HTTPS URL
- Company fields (`company_name`, `company_address`, `company_phone`, `cac_number`): required if `type` is `Dealership`

**Success Response (201):**

```json
{
  "success": true,
  "message": "Car registered successfully",
  "data": {
    "car": {
      "id": 123,
      "slug": "550e8400-e29b-41d4-a716-446655440000",
      "user_id": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
      "name_of_owner": "John Doe",
      "status": "unpaid",
      "created_at": "2026-01-18T12:00:00.000Z",
      "updated_at": "2026-01-18T12:00:00.000Z",
      "deleted_at": null
      // ... all other fields
    }
  }
}
```

**Error Responses:**

**400 Bad Request** - Validation failure
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "vehicle_year",
      "message": "Vehicle year must be between 1900 and 2027"
    }
  ]
}
```

**401 Unauthorized** - Missing or invalid token
```json
{
  "success": false,
  "message": "Authentication required"
}
```

**409 Conflict** - Duplicate identifier
```json
{
  "success": false,
  "message": "A car with registration number ABC123XY already exists"
}
```

**500 Internal Server Error** - Server error
```json
{
  "success": false,
  "message": "Failed to register car"
}
```

---

### GET /api/get-cars

Retrieve a paginated list of the authenticated user's cars.

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**

| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| `page` | integer | 1 | 1-100000 | Page number |
| `limit` | integer | 10 | 1-100 | Items per page |

**Success Response (200):**

```json
{
  "success": true,
  "message": "Cars retrieved successfully",
  "data": {
    "cars": [
      {
        "id": 123,
        "slug": "550e8400-e29b-41d4-a716-446655440000",
        "vehicle_make": "Toyota",
        "vehicle_model": "Camry",
        "status": "approved"
        // ... all other fields
      }
    ],
    "pagination": {
      "current_page": 1,
      "limit": 10,
      "total_cars": 25,
      "total_pages": 3,
      "has_next": true,
      "has_prev": false
    }
  }
}
```

**Error Responses:**

**400 Bad Request** - Invalid query parameters
```json
{
  "success": false,
  "message": "Invalid page parameter. Must be a positive integer."
}
```

**401 Unauthorized** - Missing or invalid token

---

### GET /api/cars/:slug

Retrieve a single car by slug.

**Path Parameters:**
- `slug` (UUID): The car's unique identifier

**Headers:**
```
Authorization: Bearer <token>
```

**Success Response (200):**

```json
{
  "success": true,
  "message": "Car retrieved successfully",
  "data": {
    "car": {
      "id": 123,
      "slug": "550e8400-e29b-41d4-a716-446655440000",
      "user_id": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
      "vehicle_make": "Toyota",
      "vehicle_model": "Camry"
      // ... all fields
    }
  }
}
```

**Error Responses:**

**400 Bad Request** - Invalid slug format
```json
{
  "success": false,
  "message": "Invalid slug format"
}
```

**401 Unauthorized** - Missing or invalid token

**404 Not Found** - Car not found or access denied
```json
{
  "success": false,
  "message": "Car not found or access denied"
}
```

---

### PUT /api/cars/:slug

Update a car. This is a partial update - only provided fields are updated.

**Path Parameters:**
- `slug` (UUID): The car's unique identifier

**Headers:**
```
Authorization: Bearer <token>
Content-Type: multipart/form-data  # For file uploads
# OR
Content-Type: application/json     # For URL-based updates (backward compatible)
```

**Request Body:**

All fields are optional. Only include fields you want to update.

**With File Uploads (multipart/form-data):**
```
vehicle_color: "Red"
phone_number: "+2348098765432"
document_images: [file1.jpg, file2.png]  # Replaces existing images
cac_document: new_file.pdf               # Replaces existing document
```

**With URLs (application/json - backward compatible):**
```json
{
  "vehicle_color": "Red",
  "phone_number": "+2348098765432",
  "document_images": ["https://example.com/new-doc1.jpg"]
}
```

**Fields That Cannot Be Updated:**
- `id`
- `slug`
- `user_id`
- `status`
- `created_at`
- `updated_at`
- `deleted_at`

These fields are server-controlled and will be ignored if included in the request.

**Validation:**
Same validation rules as POST apply to updated fields.

**Conflict Behavior:**
Updating `registration_no`, `chasis_no`, or `engine_no` to a value that already exists (in another non-deleted car) results in a `409 Conflict` response.

**Success Response (200):**

```json
{
  "success": true,
  "message": "Car updated successfully",
  "data": {
    "car": {
      "id": 123,
      "slug": "550e8400-e29b-41d4-a716-446655440000",
      "vehicle_color": "Red",
      "updated_at": "2026-01-18T13:30:00.000Z"
      // ... all fields
    }
  }
}
```

**Error Responses:**

**400 Bad Request** - Validation failure or invalid slug

**401 Unauthorized** - Missing or invalid token

**404 Not Found** - Car not found or access denied

**409 Conflict** - Duplicate identifier
```json
{
  "success": false,
  "message": "A car with chassis number 1HGBH41JXMN109186 already exists"
}
```

**500 Internal Server Error** - Server error

---

### DELETE /api/cars/:slug

Soft delete a car.

**Path Parameters:**
- `slug` (UUID): The car's unique identifier

**Headers:**
```
Authorization: Bearer <token>
```

**Behavior:**
- Sets `deleted_at` to current timestamp
- Car becomes inaccessible via all endpoints
- Operation is idempotent: deleting an already-deleted car returns `404`
- Unique constraints no longer apply to deleted cars

**Success Response (200):**

```json
{
  "success": true,
  "message": "Car deleted successfully",
  "data": null
}
```

**Error Responses:**

**400 Bad Request** - Invalid slug format

**401 Unauthorized** - Missing or invalid token

**404 Not Found** - Car not found, already deleted, or access denied

**500 Internal Server Error** - Server error

## Pagination

All list endpoints support pagination via query parameters.

| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| `page` | integer | 1 | 1-100000 | Current page number (1-indexed) |
| `limit` | integer | 10 | 1-100 | Number of items per page |

**Pagination Metadata:**

```json
{
  "pagination": {
    "current_page": 2,
    "limit": 10,
    "total_cars": 25,
    "total_pages": 3,
    "has_next": true,
    "has_prev": true
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `current_page` | integer | Current page number |
| `limit` | integer | Items per page |
| `total_cars` | integer | Total number of cars (excluding deleted) |
| `total_pages` | integer | Total number of pages |
| `has_next` | boolean | Whether a next page exists |
| `has_prev` | boolean | Whether a previous page exists |

## Error Handling

All error responses follow a consistent structure:

```json
{
  "success": false,
  "message": "Human-readable error message",
  "errors": [
    {
      "field": "field_name",
      "message": "Specific validation error"
    }
  ]
}
```

**Note:** The `errors` array is only present for validation failures (400).

### HTTP Status Codes

| Code | Meaning | Common Causes |
|------|---------|---------------|
| 200 | Success | Successful GET, PUT, DELETE |
| 201 | Created | Successful POST |
| 400 | Bad Request | Validation failure, invalid slug format, invalid pagination parameters |
| 401 | Unauthorized | Missing or invalid Bearer token |
| 403 | Forbidden | Email not verified |
| 404 | Not Found | Car doesn't exist, already deleted, or user doesn't own it |
| 409 | Conflict | Duplicate `registration_no`, `chasis_no`, or `engine_no` |
| 500 | Internal Server Error | Database error, unexpected server issue |

## Notes for Frontend & Mobile Teams

### Field Naming
All fields use `snake_case`. Ensure you map to `camelCase` if your application conventions require it.

### Handling 409 Conflicts
When receiving a `409` response, parse the `message` field to determine which identifier caused the conflict. The message format is:

```
"A car with <field> <value> already exists"
```

Display this message to the user and highlight the conflicting field(s) in the form.

### Handling Pagination
- Always include pagination controls when displaying car lists
- Disable "Previous" button when `has_prev` is `false`
- Disable "Next" button when `has_next` is `false`
- Display current page and total pages: "Page 2 of 5"
- Consider implementing infinite scroll using the `has_next` flag

### Slug Format
Slugs are UUIDs (v4 format). Use the slug, not the numeric ID, for all API operations after initial creation.

### Date Formats
- Send dates in ISO 8601 format: `YYYY-MM-DD` for date fields
- Receive timestamps in ISO 8601 format with timezone: `2026-01-18T12:00:00.000Z`
- Display dates formatted according to user locale

### Conditional Fields
When `registration_status` changes from `unregistered` to `registered`, ensure the form validates and requires `date_issued` and `expiry_date`.

When `type` is set to `Dealership`, ensure all company-related fields are required and validated.

### File Uploads

**Recommended Approach: Direct File Upload**

The API supports direct file uploads using `multipart/form-data`. Files are automatically uploaded to Supabase Storage and URLs are stored in the database.

**File Upload Process:**
1. Send request with `Content-Type: multipart/form-data`
2. Include files as form fields:
   - `document_images`: Multiple files (array)
   - `cac_document`: Single file
   - `letterhead`: Single file
   - `means_of_identification`: Single file
3. Include other car data as form fields
4. API validates, uploads files, and stores URLs automatically

**File Requirements:**
- **document_images**: Up to 10 files, 5MB each, formats: jpg, jpeg, png, webp
- **cac_document**: Single file, 10MB max, formats: pdf, jpg, jpeg, png
- **letterhead**: Single file, 10MB max, formats: pdf, jpg, jpeg, png
- **means_of_identification**: Single file, 10MB max, formats: pdf, jpg, jpeg, png

**Security Validations:**
- File type validation (MIME type and magic number verification)
- File size limits enforced
- Dangerous file extensions rejected (.exe, .js, .php, etc.)
- Double extension detection (e.g., file.pdf.exe)
- File content signature verification

**Backward Compatible: URL Submission**

You can still submit URLs using `application/json`:
1. Upload files to your storage service (e.g., Supabase Storage, S3)
2. Obtain the public URL
3. Pass the URL to the API

The API validates that URLs:
- Use HTTP or HTTPS protocol
- Are under 2048 characters
- Are valid URLs (not `javascript:`, `data:`, etc.)

### Status Field
The `status` field is server-controlled and represents the approval workflow:
- `unpaid`: Initial state, payment pending
- `pending`: Payment received, awaiting approval
- `approved`: Application approved
- `rejected`: Application rejected

This field cannot be modified via the API. Status changes are handled by backend workflows or admin interfaces.

### Ownership Enforcement
All operations are scoped to the authenticated user. You will never receive cars belonging to other users, and attempting to access another user's car slug results in a `404` response.

### Soft Delete Implications
Once a car is deleted, it cannot be recovered via the API. Consider implementing a confirmation dialog for DELETE operations.
