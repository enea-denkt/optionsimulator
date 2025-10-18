import { createClient } from '@base44/sdk';
// import { getAccessToken } from '@base44/sdk/utils/auth-utils';

// Create a client with authentication required
export const base44 = createClient({
  appId: "68de82a1e9a2edafebb43648", 
  requiresAuth: true // Ensure authentication is required for all operations
});
