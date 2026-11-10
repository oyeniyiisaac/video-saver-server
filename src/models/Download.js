import mongoose from 'mongoose';
import { isDbConnected } from '../config/db.js';

const downloadSchema = new mongoose.Schema(
  {
    platform: { type: String, required: true },
    url: { type: String, required: true },
    title: { type: String, default: 'Untitled' },
    type: { type: String, enum: ['video', 'audio'], default: 'video' },
    quality: { type: String, default: 'best' },
    status: { type: String, enum: ['success', 'failed'], required: true },
    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

export const Download = mongoose.model('Download', downloadSchema);

// In-memory stats fallback when MongoDB is unavailable
const memoryStats = {
  totalDownloads: 0,
  platformCounts: {},
};

/**
 * Log download attempt to MongoDB if available, otherwise record in memory.
 */
export async function recordDownload({ platform, url, title, type, quality, status }) {
  if (status === 'success') {
    memoryStats.totalDownloads += 1;
    memoryStats.platformCounts[platform] = (memoryStats.platformCounts[platform] || 0) + 1;
  }

  if (isDbConnected()) {
    try {
      await Download.create({
        platform,
        url,
        title,
        type,
        quality,
        status,
      });
    } catch (err) {
      console.error('[Download Model] Failed to save log to MongoDB:', err.message);
    }
  }
}

/**
 * Get aggregate download stats
 */
export async function getStats() {
  if (isDbConnected()) {
    try {
      const totalDownloads = await Download.countDocuments({ status: 'success' });
      const topPlatformsAgg = await Download.aggregate([
        { $match: { status: 'success' } },
        { $group: { _id: '$platform', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
        { $project: { _id: 0, platform: '$_id', count: 1 } },
      ]);
      return {
        totalDownloads,
        topPlatforms: topPlatformsAgg,
      };
    } catch (err) {
      console.error('[Download Model] Error querying MongoDB stats, falling back to in-memory:', err.message);
    }
  }

  // Fallback to in-memory stats
  const topPlatforms = Object.entries(memoryStats.platformCounts)
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalDownloads: memoryStats.totalDownloads,
    topPlatforms,
  };
}
