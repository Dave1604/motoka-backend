# Admin Car Endpoints

Two new endpoints that allow admins to add cars on behalf of users — individually or in bulk via CSV.

All requests require a valid admin token:
```
Authorization: Bearer <session.access_token>
```

---

## 1. Add Single Car

**`POST /api/admin/cars`**

Admin creates one car and assigns it to an existing user. The car appears in the user's account immediately.

### Request Body (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `user_id` | UUID | ✅ | The target user's profile ID |
| `name_of_owner` | string | ✅ | Name on the registration (2–100 chars) |
| `address` | string | ✅ | Owner address (5–500 chars) |
| `vehicle_make` | string | ✅ | e.g. "Toyota" |
| `vehicle_model` | string | ✅ | e.g. "Corolla" |
| `vehicle_year` | integer | ✅ | 1900 – current year + 1 |
| `vehicle_color` | string | ✅ | e.g. "Silver" |
| `car_type` | string | ✅ | `private` \| `commercial` |
| `registration_status` | string | ✅ | `registered` \| `unregistered` |
| `phone_number` | string | | Mobile number |
| `registration_no` | string | | Must be globally unique |
| `chasis_no` | string | | Must be globally unique |
| `engine_no` | string | | Must be globally unique |
| `date_issued` | ISO8601 date | | e.g. `2020-01-15` |
| `expiry_date` | ISO8601 date | | Required when `registration_status=registered` |
| `plate_number` | string | | |

### Success Response `201`

```json
{
  "status": true,
  "message": "Car added successfully",
  "data": {
    "car": {
      "id": 42,
      "slug": "550e8400-e29b-41d4-a716-446655440000",
      "user_id": "a1b2c3...",
      "vehicle_make": "Toyota",
      "vehicle_model": "Corolla",
      "vehicle_year": 2020,
      "vehicle_color": "Silver",
      "car_type": "private",
      "registration_status": "registered",
      "status": "unpaid",
      "registration_no": "ABC-123DE",
      "expiry_date": "2026-01-15",
      "created_at": "2026-03-29T10:00:00.000Z"
    },
    "owner": {
      "id": "a1b2c3...",
      "name": "John Doe",
      "email": "john.doe@example.com"
    }
  }
}
```

### Error Responses

| Status | Reason |
|---|---|
| `400` | Missing required fields or invalid data |
| `404` | `user_id` not found |
| `409` | Duplicate registration / chassis / engine number |
| `401` | Invalid or expired admin token |

---

## 2. Bulk Import Cars via CSV

**`POST /api/admin/cars/bulk-import`**

Admin uploads a CSV file. The backend processes each row independently — a failed row does not block the rest. Returns a detailed result report.

### Request

`Content-Type: multipart/form-data`

| Field | Type | Notes |
|---|---|---|
| `file` | File | `.csv` only, max 5 MB, max 500 rows |

### CSV Format

**Header row is required.** Columns (order doesn't matter as long as headers match):

```
user_email,name_of_owner,address,phone_number,vehicle_make,vehicle_model,vehicle_year,vehicle_color,car_type,registration_status,registration_no,chasis_no,engine_no,date_issued,expiry_date,plate_number
```

**Required columns:** `user_email`, `name_of_owner`, `address`, `vehicle_make`, `vehicle_model`, `vehicle_year`, `vehicle_color`, `car_type`, `registration_status`

**Optional columns:** `phone_number`, `registration_no`, `chasis_no`, `engine_no`, `date_issued`, `expiry_date`, `plate_number`

**Valid values:**
- `car_type`: `private` or `commercial`
- `registration_status`: `registered` or `unregistered`
- `vehicle_year`: integer between `1900` and current year + 1
- `date_issued` / `expiry_date`: `YYYY-MM-DD` format
- `user_email`: must match an existing Motoka user account

**Sample row:**
```
john.doe@example.com,John Doe,"12 Lagos Street, Abuja",08012345678,Toyota,Corolla,2020,Silver,private,registered,ABC-123DE,WBA3A5C55CF256,ENG123456,2020-01-15,2026-01-15,ABC-123DE
```

### Success Response `200`

```json
{
  "status": true,
  "message": "Import complete: 12 added, 2 failed",
  "data": {
    "total": 14,
    "succeeded": 12,
    "failed": 2,
    "created": [
      {
        "row": 2,
        "user_email": "john.doe@example.com",
        "car_slug": "550e8400-...",
        "vehicle": "Toyota Corolla (2020)"
      }
    ],
    "errors": [
      {
        "row": 5,
        "user_email": "unknown@example.com",
        "reason": "No user found with email \"unknown@example.com\""
      },
      {
        "row": 9,
        "user_email": "jane.smith@example.com",
        "reason": "Duplicate registration number already exists"
      }
    ]
  }
}
```

### Error Responses

| Status | Reason |
|---|---|
| `400` | No file attached, not a CSV, invalid format, empty file, or more than 500 rows |
| `401` | Invalid or expired admin token |
| `500` | Server error |

---

## Frontend Usage

These endpoints are consumed by two modal components in the admin panel:

- **`AddCarModal`** (`src/components/admin/AddCarModal.jsx`) — 2-step flow: search for user → fill car form
- **`BulkImportModal`** (`src/components/admin/BulkImportModal.jsx`) — drag-and-drop CSV upload, template download, row-by-row result display

Both are triggered from the **Cars** admin page (`/admin/cars`) via the **"Add Car"** and **"Bulk Import"** buttons in the page header. On success, the car list automatically refreshes.
