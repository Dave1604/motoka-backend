# Admin RBAC (Role-Based Access Control) Guide

## Current Setup

### Admin Authentication
- Any user with `is_admin = true` in `profiles` table can log in as admin
- Admin login uses JWT tokens (30-minute expiry)
- Email OTP verification (6-digit numeric code)

### Current Admin Check
```javascript
// In adminAuth.controller.js
if (!profile.is_admin) {
  return response.forbidden(res, 'Access denied: Admin privileges required');
}
```

## Adding Multiple Admin Types (RBAC)

### Option 1: Use Existing `user_types` Table

You already have a `user_types` table with `Super_admin` (id=1).

**Steps:**
1. Add more admin types to `user_types`:
   ```sql
   INSERT INTO user_types (name) VALUES
     ('Admin'),           -- General admin
     ('Moderator'),       -- Can manage content
     ('Support'),         -- Can view and help users
     ('Finance_Admin');   -- Can manage payments
   ```

2. Update admin check to allow multiple types:
   ```javascript
   // adminAuth.controller.js
   const ADMIN_TYPE_IDS = [1, 2, 3, 4]; // Super_admin, Admin, Moderator, Support
   
   if (!profile.is_admin && !ADMIN_TYPE_IDS.includes(profile.user_type_id)) {
     return response.forbidden(res, 'Access denied: Admin privileges required');
   }
   ```

3. Add role to JWT token payload:
   ```javascript
   const token = jwt.sign(
     {
       id: user.id,
       email: user.email,
       is_admin: true,
       role: profile.user_types?.name || 'Admin', // Add role
       type: 'admin'
     },
     process.env.JWT_SECRET,
     { expiresIn: '30m' }
   );
   ```

4. Check permissions in routes:
   ```javascript
   // middleware/checkAdminRole.js
   export const requireRole = (allowedRoles) => {
     return (req, res, next) => {
       const userRole = req.admin?.role;
       
       if (!allowedRoles.includes(userRole)) {
         return forbidden(res, 'Insufficient permissions');
       }
       
       next();
     };
   };
   
   // Usage in routes
   router.delete('/users/:id', 
     authenticateAdmin, 
     requireRole(['Super_admin']),  // Only super admin can delete users
     admin.deleteUser
   );
   
   router.get('/users', 
     authenticateAdmin,
     requireRole(['Super_admin', 'Admin', 'Support']),  // Multiple roles allowed
     admin.listUsers
   );
   ```

### Option 2: Create Dedicated `admin_roles` Table (More Granular)

For more complex permission systems:

**1. Create migration:**
```sql
-- Migration: create_admin_roles.sql
CREATE TABLE admin_roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  permissions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add admin_role_id to profiles
ALTER TABLE profiles 
ADD COLUMN admin_role_id INTEGER REFERENCES admin_roles(id);

-- Insert default roles
INSERT INTO admin_roles (name, description, permissions) VALUES
  ('Super Admin', 'Full system access', '["*"]'),
  ('Admin', 'General admin access', '["users.read", "users.write", "cars.read", "cars.write", "orders.read", "orders.write"]'),
  ('Moderator', 'Content moderation', '["users.read", "cars.read", "cars.write", "orders.read"]'),
  ('Support', 'User support', '["users.read", "orders.read"]'),
  ('Finance', 'Payment management', '["payments.read", "payments.write", "orders.read"]');
```

**2. Create permission checker:**
```javascript
// middleware/checkPermission.js
export const checkPermission = (requiredPermission) => {
  return async (req, res, next) => {
    const { admin_role_id } = req.admin;
    
    // Fetch role permissions
    const { data: role } = await supabaseAdmin
      .from('admin_roles')
      .select('permissions')
      .eq('id', admin_role_id)
      .single();
    
    const permissions = role?.permissions || [];
    
    // Check if has permission
    if (permissions.includes('*') || permissions.includes(requiredPermission)) {
      return next();
    }
    
    return forbidden(res, 'Insufficient permissions');
  };
};

// Usage
router.delete('/users/:id',
  authenticateAdmin,
  checkPermission('users.delete'),
  admin.deleteUser
);
```

## Email Setup for Multiple Admins

### Development (Test API Key)
- Resend test keys only send to verified email: `rasak@motokaapp.ng`
- For testing with multiple admins, use `rasak@motokaapp.ng` or upgrade to production key

### Production
1. **Get Production API Key:**
   - Go to resend.com
   - Create a production API key
   - Replace in `.env`:
     ```env
     RESEND_API_KEY=re_your_production_key_here
     ```

2. **Create Admin Users:**
   ```sql
   -- In Supabase
   -- Any user with is_admin = true can be admin
   UPDATE profiles 
   SET is_admin = true, user_type_id = 1 
   WHERE email = 'admin@motokaapp.ng';
   ```

3. **Send to Any Email:**
   - With production key + verified domain, you can send to:
     - Any `@motokaapp.ng` email
     - Other domains if you verify them in Resend

## Frontend RBAC

### Conditional UI Based on Role

```javascript
// In AdminDashboard or any component
const adminRole = JSON.parse(localStorage.getItem('adminUser'))?.role;

// Conditionally render based on role
{adminRole === 'Super_admin' && (
  <button onClick={handleDeleteUser}>Delete User</button>
)}

{['Super_admin', 'Admin', 'Finance'].includes(adminRole) && (
  <Link to="/admin/payments">Payments</Link>
)}
```

### Protect Routes by Role

```javascript
// AdminRoutes.jsx
const AdminRoutes = () => {
  const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
  const role = adminUser.role;

  return (
    <Routes>
      {/* All admins */}
      <Route path="dashboard" element={<AdminDashboard />} />
      
      {/* Only Super_admin and Admin */}
      {['Super_admin', 'Admin'].includes(role) && (
        <Route path="users" element={<AdminUsers />} />
      )}
      
      {/* Only Super_admin, Admin, Finance */}
      {['Super_admin', 'Admin', 'Finance'].includes(role) && (
        <Route path="payments" element={<AdminPayments />} />
      )}
    </Routes>
  );
};
```

## Security Best Practices

1. **Always validate permissions on backend** - frontend checks are just for UX
2. **Use short JWT expiry** (current: 30 minutes is good)
3. **Log admin actions** for audit trail
4. **Implement IP whitelisting** for super admin actions
5. **Add 2FA** for sensitive operations
6. **Rate limit admin endpoints** (re-enable for production)

## Implementation Checklist

- [ ] Decide: Use `user_types` or create `admin_roles` table
- [ ] Update backend permission checks
- [ ] Add role to JWT payload
- [ ] Create permission middleware
- [ ] Update frontend to show/hide based on role
- [ ] Get production Resend API key
- [ ] Create admin user accounts in Supabase
- [ ] Test all role combinations
- [ ] Document admin permissions for team
- [ ] Set up audit logging for admin actions

## Current Files to Modify

**Backend:**
- `src/controllers/adminAuth.controller.js` - Add role to JWT
- `src/middleware/checkAdminRole.js` - Create role checker (new file)
- `src/routes/admin.routes.js` - Add role checks to routes
- `src/routes/adminAuth.routes.js` - Re-enable rate limiters for production

**Frontend:**
- `src/components/admin/AdminLayout.jsx` - Show/hide nav based on role
- `src/routes/AdminRoutes.jsx` - Protect routes by role
- All admin pages - Conditionally show actions based on role

## Quick Start: Add Second Admin Type

```sql
-- 1. In Supabase, add a Moderator type
INSERT INTO user_types (name) VALUES ('Moderator');

-- 2. Make a user a moderator
UPDATE profiles 
SET is_admin = true, user_type_id = 5  -- Assuming Moderator got id=5
WHERE email = 'moderator@motokaapp.ng';
```

```javascript
// 3. In backend, allow both Super_admin and Moderator
const ADMIN_TYPE_IDS = [1, 5]; // Super_admin, Moderator

if (!profile.is_admin && !ADMIN_TYPE_IDS.includes(profile.user_type_id)) {
  return response.forbidden(res, 'Access denied');
}
```

Done! You now have basic RBAC support.
