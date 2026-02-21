Driver License API Documentation
Overview

The Driver License API manages driver’s license applications for users. It supports applying for a new license, renewing an expired license, and replacing a lost or damaged license. All operations are strictly scoped to the authenticated user.

Key Behaviors:

User-scoped access: users can only access their own license records

License-type–based validation (new, renew, lost_damaged)

Server-controlled fields (status, license number, user association)

Automatic license number generation for new licenses

Latest-first ordering when listing licenses

Scope:

Create driver license applications

Retrieve all licenses belonging to a user

Retrieve a single license by slug

Base URL

Base Path: /api

All Driver License API endpoints are prefixed with /api.

Module Prefix:

/driver-license
Authentication

All endpoints require authentication via Bearer token.

Header:

Authorization: Bearer <supabase_jwt_token>

Unauthenticated Requests:

Status: 401 Unauthorized

Response: Standard error object

User Context:

The authenticated Supabase user is attached to req.user

req.user.id (UUID) is used internally as user_id

License Types
Type	Description
new	Apply for a brand-new driver’s license
renew	Renew an expired driver’s license
lost_damaged	Replace a lost or damaged driver’s license
Data Model
Driver License Object
Field	Type	Description	Category
id	UUID	Primary key	Server-controlled
slug	string	Unique identifier for URL access	Server-controlled
user_id	UUID	Owner of the license	Server-controlled
license_type	enum	new, renew, lost_damaged	Required
license_number	string	Generated license number	Server-controlled / Conditional
status	enum	unpaid, paid, processing, approved, rejected	Server-controlled
full_name	string	Applicant full name	Conditional*
phone_number	string	Applicant phone number	Conditional*
address	string	Residential address	Conditional*
date_of_birth	date	Date of birth	Conditional*
place_of_birth	string	Place of birth	Optional
state_of_origin	string	State of origin	Optional
local_government	string	Local government area	Optional
blood_group	string	Blood group	Optional
height	string	Height	Optional
occupation	string	Occupation	Optional
next_of_kin	string	Next of kin name	Optional
next_of_kin_phone	string	Next of kin phone number	Optional
mother_maiden_name	string	Mother’s maiden name	Optional
license_year	number	License duration in years	Conditional*
expired_license_upload	string (URL)	Upload of expired license	Conditional**
created_at	timestamp	Creation timestamp	Server-controlled
Conditional Fields

*Required when license_type = new

**Required when license_type = renew

For lost_damaged:

license_number is required

date_of_birth is required

Constraints & Business Rules
Ownership Rules

Users can only access licenses that belong to them

Attempting to access another user’s license returns 404 Not Found

License Number Generation

License numbers are automatically generated for new licenses

Format example:

DL-1700000000000-321
Status Control

The status field is server-controlled and cannot be set by the client.

Status	Meaning
unpaid	Application created, payment pending
paid	Payment completed
processing	Under review
approved	License approved
rejected	License rejected
Endpoints
POST /api/driver-license/apply

Create a driver license application (new, renew, or lost/damaged).

Headers:

Authorization: Bearer <token>
Content-Type: application/json
Request Body – New License
{
  "license_type": "new",
  "full_name": "John Doe",
  "phone_number": "+2348012345678",
  "address": "12 Allen Avenue, Ikeja, Lagos",
  "date_of_birth": "1998-05-12",
  "place_of_birth": "Lagos",
  "state_of_origin": "Lagos",
  "local_government": "Ikeja",
  "blood_group": "O+",
  "height": "5ft 9in",
  "occupation": "Software Engineer",
  "next_of_kin": "Jane Doe",
  "next_of_kin_phone": "+2348098765432",
  "mother_maiden_name": "Smith",
  "license_year": 3
}

Required Fields (new):

license_type

full_name

phone_number

address

date_of_birth

license_year

Request Body – Renew License
{
  "license_type": "renew",
  "expired_license_upload": "https://example.com/expired-license.jpg"
}

Required Fields (renew):

license_type

expired_license_upload

Request Body – Lost or Damaged License
{
  "license_type": "lost_damaged",
  "license_number": "DL-1700000000000-321",
  "date_of_birth": "1998-05-12"
}

Required Fields (lost_damaged):

license_type

license_number

date_of_birth

Success Response (201)
{
  "status": true,
  "message": "Driver license request created",
  "data": {
    "id": "uuid",
    "slug": "dl-new-1700000000",
    "user_id": "auth-uuid",
    "license_type": "new",
    "license_number": "DL-1700000000000-321",
    "status": "unpaid",
    "created_at": "2026-02-20T10:45:00Z"
  }
}
Error Responses

400 Bad Request – Invalid License Type

{
  "status": false,
  "message": "Invalid license type"
}

400 Bad Request – Missing Required Fields

{
  "status": false,
  "message": "Missing required fields for new license"
}

500 Internal Server Error

{
  "status": false,
  "message": "Failed to create driver license"
}
GET /api/driver-license/license

Retrieve all driver licenses belonging to the authenticated user.

Headers:

Authorization: Bearer <token>
Success Response (200)
{
  "status": true,
  "data": [
    {
      "id": "uuid",
      "slug": "dl-renew-1700001111",
      "license_type": "renew",
      "license_number": "DL-1700000000000-321",
      "status": "unpaid",
      "created_at": "2026-02-19T09:00:00Z"
    },
    {
      "id": "uuid",
      "slug": "dl-new-1699999999",
      "license_type": "new",
      "license_number": "DL-1699999999999-876",
      "status": "paid",
      "created_at": "2026-01-10T14:30:00Z"
    }
  ]
}

Behavior:

Results are ordered by created_at (latest first)

Only licenses belonging to the authenticated user are returned

Error Response (500)
{
  "status": false,
  "message": "Failed to fetch licenses"
}
GET /api/driver-license/:slug

Retrieve a single driver license by slug.

Path Parameters:

Parameter	Type	Description
slug	string	Unique license identifier

Headers:

Authorization: Bearer <token>
Success Response (200)
{
  "status": true,
  "data": {
    "id": "uuid",
    "slug": "dl-new-1700000000",
    "license_type": "new",
    "license_number": "DL-1700000000000-321",
    "status": "unpaid",
    "full_name": "John Doe",
    "phone_number": "+2348012345678",
    "created_at": "2026-02-20T10:45:00Z"
  }
}
Error Responses

404 Not Found

{
  "status": false,
  "message": "License not found"
}

500 Internal Server Error

{
  "status": false,
  "message": "Failed to fetch license"
}
Summary of Routes
Method	Endpoint	Description
POST	/api/driver-license/apply	Apply for driver license
GET	/api/driver-license/license	Get all user licenses
GET	/api/driver-license/:slug	Get single license
Notes for Frontend & Mobile Teams

All fields use snake_case

Always store and reuse the slug for navigation

Do not attempt to set status, user_id, or license_number

Handle 404 as “not found or not owned”

Dates must be sent in YYYY-MM-DD format

Status changes occur outside this API (admin/payment workflows)