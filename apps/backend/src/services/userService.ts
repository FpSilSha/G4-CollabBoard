import prisma from '../models/index';
import { generateColorFromUserId, generateAvatar } from '../utils/helpers';
import { AppError } from '../middleware/errorHandler';

export const userService = {
  /**
   * Find or create a user from Auth0 profile data.
   * Called on first authenticated request to ensure user exists in our DB.
   */
  async findOrCreateUser(auth0Id: string, email?: string, name?: string) {
    let user = await prisma.user.findUnique({
      where: { id: auth0Id },
    });

    if (!user) {
      // Check if a user with this email already exists (e.g., from a different auth provider)
      if (email) {
        user = await prisma.user.findUnique({
          where: { email },
        });

        if (user) {
          return user;
        }
      }

      // Generate defaults for missing fields (e.g., M2M tokens don't carry user profile)
      const displayName = name || email?.split('@')[0] || auth0Id.split('|').pop() || 'User';
      const displayEmail = email || `${auth0Id}@clients.auth0.local`;

      user = await prisma.user.create({
        data: {
          id: auth0Id,
          email: displayEmail,
          name: displayName,
          avatar: generateAvatar(displayName),
          color: generateColorFromUserId(auth0Id),
          subscriptionTier: 'ENTERPRISE', // All users get Enterprise until Stripe is integrated
        },
      });
    } else {
      // Recompute color on every login — ensures hash function changes
      // propagate immediately (e.g., FNV-1a migration from old Java hash).
      const correctColor = generateColorFromUserId(auth0Id);

      // Update existing user's email/name if they were previously created
      // with fallback values (e.g., numeric Auth0 sub ID as name)
      const needsProfileUpdate =
        (email && user.email !== email && user.email.endsWith('@clients.auth0.local')) ||
        (name && user.name !== name) ||
        (email && !name && /^\d+$/.test(user.name));

      if (needsProfileUpdate || user.color !== correctColor) {
        const updatedName = needsProfileUpdate
          ? (name || email?.split('@')[0] || user.name)
          : user.name;
        const updatedEmail = needsProfileUpdate
          ? (email || user.email)
          : user.email;
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            email: updatedEmail,
            name: updatedName,
            avatar: generateAvatar(updatedName),
            color: correctColor,
          },
        });
      }
    }

    return user;
  },

  async getUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    return user;
  },

  async updateProfile(userId: string, name: string) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        name,
        avatar: generateAvatar(name),
      },
    });

    return user;
  },
};
