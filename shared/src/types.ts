import type { Role, Visibility } from './constants.js';

export interface MeDto {
  id: string;
  username: string;
  role: Role;
  createdAt: string;
}

export interface VenueDto {
  id: string;
  name: string;
  street: string | null;
  city: string | null;
  country: string | null;
  lat: number;
  lon: number;
  osmId: number | null;
}

export interface PhotoDto {
  id: string;
  width: number;
  height: number;
  position: number;
  thumbUrl: string;
  fullUrl: string;
}

export interface AttendeeDto {
  id: string;
  personId: string | null;
  name: string;
}

export interface VisitDto {
  id: string;
  venue: VenueDto;
  visitedAt: string;
  description: string;
  rating: number;
  priceIndication: number | null;
  tags: string[];
  visibility: Visibility;
  attendees: AttendeeDto[];
  photos: PhotoDto[];
  crawlId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Paged<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export interface PersonDto {
  id: string;
  name: string;
  visitCount: number;
}

export interface CrawlDto {
  id: string;
  name: string;
  crawlDate: string;
  notes: string;
  stopCount: number;
  totalDistanceM: number;
  averageRating: number | null;
}

export interface CrawlStopDto {
  position: number;
  distanceFromPrevM: number | null;
  visit: VisitDto;
}

export interface CrawlDetailDto extends CrawlDto {
  stops: CrawlStopDto[];
  attendees: string[];
}

/** Eigen bezochte tent op de kaart. */
export interface MineMapFeature {
  venueId: string;
  name: string;
  city: string | null;
  lat: number;
  lon: number;
  visitCount: number;
  avgRating: number;
  lastVisitedAt: string;
  lastVisitId: string;
}

/** Anoniem gemelde tent op de kaart, altijd boven de k-drempel. */
export interface PublicMapFeature {
  venueId: string;
  name: string;
  city: string | null;
  lat: number;
  lon: number;
  reportCount: number;
  reporterCount: number;
  avgRating: number;
  topTags: string[];
  firstMonth: string;
  lastMonth: string;
}

export interface PublicReportDto {
  reportId: string;
  rating: number;
  tags: string[];
  description: string;
  visitedMonth: string;
}

export interface HeatPointDto {
  lat: number;
  lon: number;
  weight: number;
}

export interface StatsDto {
  venueCount: number;
  visitCount: number;
  cityCount: number;
  crawlCount: number;
  totalDistanceM: number;
  averageRating: number | null;
  topVenue: { venueId: string; name: string; city: string | null; avgRating: number; visitCount: number } | null;
  topCompanion: { name: string; visitCount: number } | null;
  ratingHistogram: Array<{ rating: number; count: number }>;
  perMonth: Array<{ month: string; visitCount: number }>;
}

export interface ModerationItemDto {
  reportId: string;
  contentReportId: string;
  reason: string;
  status: string;
  createdAt: string;
  venueName: string;
  description: string;
  hidden: boolean;
}

export interface FriendDto {
  friendshipId: string;
  userId: string;
  username: string;
  status: 'pending' | 'accepted';
  direction: 'incoming' | 'outgoing' | 'mutual';
}

export interface GeocodeResultDto {
  displayName: string;
  name: string;
  lat: number;
  lon: number;
  street: string | null;
  city: string | null;
  country: string | null;
  osmId: number | null;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}
