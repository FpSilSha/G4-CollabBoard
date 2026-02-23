import { generateColorFromUserId, generateAvatar } from '../utils/helpers';
import { AppError } from '../middleware/errorHandler';
import { prismaUserRepository } from '../repositories/userRepository';
import type { UserRepository } from '../repositories/userRepository';

export function createUserService(repo: UserRepository = prismaUserRepository) {
  return {
    async findOrCreateUser(auth0Id: string, email?: string, name?: string) {
      let user = await repo.findById(auth0Id);

      if (!user) {
        // Check if a user with this email already exists (e.g., from a different auth provider)
        if (email) {
          user = await repo.findByEmail(email);

          if (user) {
            return user;
          }
        }

        // Generate defaults for missing fields (e.g., M2M tokens don't carry user profile)
        const displayName = name || email?.split('@')[0] || auth0Id.split('|').pop() || 'User';
        const displayEmail = email || `${auth0Id}@clients.auth0.local`;

        try {
          user = await repo.create({
            id: auth0Id,
            email: displayEmail,
            name: displayName,
            avatar: generateAvatar(displayName),
            color: generateColorFromUserId(auth0Id),
            subscriptionTier: 'ENTERPRISE', // All users get Enterprise until Stripe is integrated
          });
        } catch (createErr: any) {
          // Handle race condition: concurrent requests can both get null from
          // findById then both try to create. Catch the unique constraint
          // violation (Prisma P2002) and retry the lookup.
          if (createErr?.code === 'P2002') {
            user = await repo.findById(auth0Id);
            if (!user && email) user = await repo.findByEmail(email);
            if (!user) throw createErr;
          } else {
            throw createErr;
          }
        }
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
          user = await repo.update(user.id, {
            email: updatedEmail,
            name: updatedName,
            avatar: generateAvatar(updatedName),
            color: correctColor,
          });
        }
      }

      return user;
    },

    async getUser(userId: string) {
      const user = await repo.findById(userId);

      if (!user) {
        throw new AppError(404, 'User not found');
      }

      return user;
    },

    async updateProfile(userId: string, name: string) {
      const user = await repo.update(userId, {
        name,
        avatar: generateAvatar(name),
      });

      return user;
    },
  };
}

/** Default singleton for production use — consumers import this. */
export const userService = createUserService();
