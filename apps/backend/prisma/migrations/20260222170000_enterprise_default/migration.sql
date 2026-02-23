-- Set all existing users to ENTERPRISE tier (no Stripe integration yet).
-- New users are created as ENTERPRISE in userService.findOrCreateUser.
UPDATE "User" SET "subscriptionTier" = 'ENTERPRISE' WHERE "subscriptionTier" != 'ENTERPRISE';
