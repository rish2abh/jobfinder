import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../services/api';

interface UserState {
  user: User | null;
  userId: string | null;
  setUser: (user: User) => void;
  clearUser: () => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      user: null,
      userId: null,
      setUser: (user) => set({ user, userId: user._id }),
      clearUser: () => set({ user: null, userId: null }),
    }),
    {
      name: 'jobfinder-user',
    }
  )
);
