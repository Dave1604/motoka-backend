# Document Upload Feature

This document describes the document upload flow for car documents and driver's license documents in Motoka.

## Overview

- **Users** can upload documents for their cars and driver's license from the Car Documents page (`/documents`).
- **Admins** can view all documents, approve/reject pending ones, and upload documents on behalf of users.

## Document Types

| Type | Description | Required Fields |
|------|-------------|-----------------|
| `car` | Vehicle documents (license, road worthiness, etc.) | `car_slug` or `car_id` |
| `driver_license` | Driver's license documents | None (user-scoped) |

## User Flow

### Car Documents

1. User goes to **Documents** → **My Cars** tab.
2. Selects a car from the car selector.
3. Clicks **Add Documents** or drags a file to upload.
4. File is uploaded to Supabase Storage: `{userId}/{carSlug}/`
5. Document record is created with `status: pending`.
6. Admin reviews and approves or rejects.

### Driver's License Documents

1. User goes to **Documents** → **My Driver's License** tab.
2. Clicks **Add Documents** or selects a file.
3. File is uploaded to Supabase Storage: `{userId}/driver_license/`
4. Document record is created with `status: pending`.
5. Admin reviews and approves or rejects.

## Admin Flow

### Viewing Documents

- Navigate to **Admin** → **Documents** (`/admin/documents`).
- Filter by status (pending, approved, rejected), type (car, driver_license), or user ID.
- Click **View** to preview a document (image or PDF).

### Approving / Rejecting

- Open document preview.
- For pending documents: **Approve** or **Reject**.
- Reject optionally includes a reason (stored in `rejection_reason`).

### Uploading for a User

- Click **Upload for User**.
- Provide: User ID (Supabase UUID), document type, and file.
- For car documents: also provide car slug or car ID.

## API Reference

### User Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/documents/upload` | Upload a document (user or admin) |
| GET | `/api/documents/car/:carSlug` | Get car documents for a car |
| GET | `/api/documents/driver-license` | Get driver's license documents |

### Admin Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/documents` | List documents (with filters) |
| GET | `/api/admin/documents/:id` | Get document details |
| POST | `/api/admin/documents/upload` | Upload document for a user |
| PUT | `/api/admin/documents/:id/approve` | Approve document |
| PUT | `/api/admin/documents/:id/reject` | Reject document |

### User Upload (POST /api/documents/upload)

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| file | File | Yes | Image (JPEG, PNG, WebP) or PDF |

**For car documents:**

| Field | Type | Required |
|-------|------|----------|
| document_type | string | Yes (`car`) |
| car_slug | string | Yes |

**For driver's license:**

| Field | Type | Required |
|-------|------|----------|
| document_type | string | Yes (`driver_license`) |

### Admin Upload (POST /api/admin/documents/upload)

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| file | File | Yes | Image or PDF |
| user_id | string | Yes | Supabase user UUID |
| document_type | string | Yes | `car` or `driver_license` |
| car_slug | string | Yes (for car) | Car slug |
| car_id | string | Yes (for car) | Car ID (alternative to car_slug) |
| document_category | string | No | Optional category |

**Headers:** `Authorization: Bearer <adminToken>`

## Storage Structure

Supabase Storage bucket: `car-documents`

```
{userId}/
  {carSlug}/           # Car documents
    filename.pdf
  driver_license/     # Driver's license documents
    filename.jpg
```

## Database Schema

**Table:** `documents`

| Column | Type | Description |
|--------|------|-------------|
| id | BIGSERIAL | Primary key |
| user_id | UUID | Owner |
| car_id | BIGINT | Null for driver_license |
| document_type | enum | `car` \| `driver_license` |
| document_category | VARCHAR | Optional |
| file_url | TEXT | Supabase Storage URL |
| status | enum | `pending` \| `approved` \| `rejected` |
| uploaded_by_type | enum | `user` \| `admin` |
| uploaded_by_user_id | UUID | Admin who uploaded (if admin) |
| rejection_reason | TEXT | Reason if rejected |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

## File Constraints

- **Max size:** 10MB
- **Allowed types:** JPEG, PNG, WebP, PDF

## Frontend Components

- `CarDocuments.jsx` – Main page with tabs
- `DocumentPage.jsx` – Document list and upload area
- `DocumentList.jsx` – Car documents
- `LicenseDoc.jsx` – Driver's license documents
- `DocPreview.jsx` – Document preview
- `AdminDocuments.jsx` – Admin document management

## Services

- `apiDocument.js` – User document API
- `apiAdminDocument.js` – Admin document API
