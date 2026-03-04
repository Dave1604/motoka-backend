# Driver's License Flow (Figma Implementation)

This document describes the driver's license flow implemented to match the Figma designs.

## User Flows

### 1. New Driver's License

1. **Licenses** → Driver's License
2. Select **New Driver's License**
3. **Full application form** (Figma flow 1):
   - Upload Passport Photograph
   - Full Name, Phone, Address, DOB, Place of Birth, Home of Origin, LGA
   - Blood Group, Height, Occupation
   - Next of Kin Name & Phone, Mother's Maiden Name, License Years
   - "Confirm and Proceed"
4. **Confirm Request** (Figma flow 4):
   - Order summary
   - "Complete Pay Now"
5. **Payment** → Monicredit or Paystack

### 2. Renew Driver's License

1. **Licenses** → Driver's License
2. Select **Renew Driver's License**
3. **License details** (Figma flow 3):
   - License Number, Date of Birth, Date of Expiry (each with price)
   - If expiry date is in the past → **Expired** badge shown (Figma flow 2)
   - "Upload Driver's License" box
   - Example section
   - "Confirm and Proceed"
4. **Confirm Request** → "Complete Pay Now"
5. **Payment**

## Backend

### Tables

- **driver_license_applications** (migration 039): Stores form data per user and type (new/renew)
- **documents**: Passport and license file uploads (document_type: driver_license)
- **driver_license_prices**: Pricing (new/renew)
- **payment_transactions** / **renewal_orders**: Payment flow

### API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/driver-license-applications/me?type=new\|renew` | Get application |
| PUT | `/api/driver-license-applications/me` | Create/update application |
| POST | `/api/documents/upload` | Upload passport or license (document_type: driver_license) |
| GET | `/api/documents/driver-license` | List license documents |
| POST | `/api/payments/initialize` | Start payment (payment_type: driver_license) |

## Frontend Routes

- `/licenses` – Licenses hub
- `/licenses/drivers-license` – New vs Renew choice
- `/licenses/drivers-license/new` – Full form (new)
- `/licenses/drivers-license/renew` – License details + upload (renew)
- `/licenses/drivers-license/order-summary` – Confirm Request
- `/payment` – Payment options

## Figma Alignment

| Figma Screen | Implementation |
|--------------|-----------------|
| Full form + passport upload | `DriverLicenseForm.jsx` |
| Expired badge + re-upload | `DriverLicenseRenew.jsx` (when date_of_expiry &lt; today) |
| License Number, DOB, Expiry | `DriverLicenseRenew.jsx` |
| Confirm Request + Complete Pay Now | `DriverLicenseOrderSummary.jsx` |
