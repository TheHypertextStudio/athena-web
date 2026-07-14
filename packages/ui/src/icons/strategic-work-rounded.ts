/**
 * Searchable rounded Material icon catalog for strategic-work display metadata.
 *
 * @remarks
 * Persisted keys remain presentation-library neutral in `@docket/types`; this module is the only
 * place that maps those keys to the current rounded Material glyphs and search vocabulary.
 */
import type { EntityDisplayIconKey } from '@docket/types';
import AccountBalanceRounded from '@mui/icons-material/AccountBalanceRounded';
import AccountTreeRounded from '@mui/icons-material/AccountTreeRounded';
import AnalyticsRounded from '@mui/icons-material/AnalyticsRounded';
import ApartmentRounded from '@mui/icons-material/ApartmentRounded';
import ArticleRounded from '@mui/icons-material/ArticleRounded';
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded';
import BoltRounded from '@mui/icons-material/BoltRounded';
import CampaignRounded from '@mui/icons-material/CampaignRounded';
import ConstructionRounded from '@mui/icons-material/ConstructionRounded';
import DirectionsBusRounded from '@mui/icons-material/DirectionsBusRounded';
import Diversity3Rounded from '@mui/icons-material/Diversity3Rounded';
import EmojiPeopleRounded from '@mui/icons-material/EmojiPeopleRounded';
import EngineeringRounded from '@mui/icons-material/EngineeringRounded';
import EventRounded from '@mui/icons-material/EventRounded';
import ExploreRounded from '@mui/icons-material/ExploreRounded';
import FavoriteRounded from '@mui/icons-material/FavoriteRounded';
import FolderOpenRounded from '@mui/icons-material/FolderOpenRounded';
import ForumRounded from '@mui/icons-material/ForumRounded';
import GavelRounded from '@mui/icons-material/GavelRounded';
import GroupsRounded from '@mui/icons-material/GroupsRounded';
import HandshakeRounded from '@mui/icons-material/HandshakeRounded';
import HowToVoteRounded from '@mui/icons-material/HowToVoteRounded';
import HubRounded from '@mui/icons-material/HubRounded';
import InsightsRounded from '@mui/icons-material/InsightsRounded';
import LanguageRounded from '@mui/icons-material/LanguageRounded';
import LayersRounded from '@mui/icons-material/LayersRounded';
import LightbulbRounded from '@mui/icons-material/LightbulbRounded';
import LocalLibraryRounded from '@mui/icons-material/LocalLibraryRounded';
import MapRounded from '@mui/icons-material/MapRounded';
import MenuBookRounded from '@mui/icons-material/MenuBookRounded';
import OutlinedFlagRounded from '@mui/icons-material/OutlinedFlagRounded';
import ParkRounded from '@mui/icons-material/ParkRounded';
import PodcastsRounded from '@mui/icons-material/PodcastsRounded';
import PolicyRounded from '@mui/icons-material/PolicyRounded';
import PsychologyRounded from '@mui/icons-material/PsychologyRounded';
import PublicRounded from '@mui/icons-material/PublicRounded';
import RecordVoiceOverRounded from '@mui/icons-material/RecordVoiceOverRounded';
import RocketLaunchRounded from '@mui/icons-material/RocketLaunchRounded';
import RouteRounded from '@mui/icons-material/RouteRounded';
import SchoolRounded from '@mui/icons-material/SchoolRounded';
import SecurityRounded from '@mui/icons-material/SecurityRounded';
import StarRounded from '@mui/icons-material/StarRounded';
import SubwayRounded from '@mui/icons-material/SubwayRounded';
import TimelineRounded from '@mui/icons-material/TimelineRounded';
import TrackChangesRounded from '@mui/icons-material/TrackChangesRounded';
import TrainRounded from '@mui/icons-material/TrainRounded';
import TravelExploreRounded from '@mui/icons-material/TravelExploreRounded';
import TrendingUpRounded from '@mui/icons-material/TrendingUpRounded';
import VerifiedRounded from '@mui/icons-material/VerifiedRounded';
import VolunteerActivismRounded from '@mui/icons-material/VolunteerActivismRounded';
import WorkspacePremiumRounded from '@mui/icons-material/WorkspacePremiumRounded';
import type SvgIcon from '@mui/material/SvgIcon';

/** One searchable rounded icon option exposed to strategic-work pickers. */
export interface StrategicWorkRoundedIconOption {
  key: EntityDisplayIconKey;
  label: string;
  keywords: readonly string[];
  icon: typeof SvgIcon;
}

/** Complete rounded icon catalog keyed by library-neutral display values. */
export const STRATEGIC_WORK_ROUNDED_ICON_OPTIONS = [
  {
    key: 'target',
    label: 'Target',
    keywords: ['goal', 'objective', 'okr'],
    icon: TrackChangesRounded,
  },
  { key: 'flag', label: 'Flag', keywords: ['milestone', 'priority'], icon: OutlinedFlagRounded },
  { key: 'layers', label: 'Layers', keywords: ['portfolio', 'stack'], icon: LayersRounded },
  { key: 'folder', label: 'Folder', keywords: ['project', 'files'], icon: FolderOpenRounded },
  { key: 'workflow', label: 'Workflow', keywords: ['process', 'tree'], icon: AccountTreeRounded },
  { key: 'globe', label: 'Globe', keywords: ['world', 'regional', 'public'], icon: PublicRounded },
  { key: 'users', label: 'People', keywords: ['group', 'team', 'community'], icon: GroupsRounded },
  {
    key: 'sparkles',
    label: 'Sparkles',
    keywords: ['magic', 'new', 'creative'],
    icon: AutoAwesomeRounded,
  },
  { key: 'bus', label: 'Bus', keywords: ['transit', 'transportation'], icon: DirectionsBusRounded },
  {
    key: 'train',
    label: 'Train',
    keywords: ['transit', 'rail', 'transportation'],
    icon: TrainRounded,
  },
  { key: 'subway', label: 'Subway', keywords: ['transit', 'metro', 'rail'], icon: SubwayRounded },
  { key: 'route', label: 'Route', keywords: ['path', 'transit', 'roadmap'], icon: RouteRounded },
  { key: 'map', label: 'Map', keywords: ['place', 'region', 'geography'], icon: MapRounded },
  {
    key: 'campaign',
    label: 'Campaign',
    keywords: ['megaphone', 'advocacy', 'outreach'],
    icon: CampaignRounded,
  },
  {
    key: 'school',
    label: 'School',
    keywords: ['education', 'students', 'youth'],
    icon: SchoolRounded,
  },
  {
    key: 'book',
    label: 'Book',
    keywords: ['education', 'reading', 'learning'],
    icon: MenuBookRounded,
  },
  {
    key: 'event',
    label: 'Event',
    keywords: ['calendar', 'meeting', 'gathering'],
    icon: EventRounded,
  },
  {
    key: 'handshake',
    label: 'Handshake',
    keywords: ['partner', 'coalition', 'agreement'],
    icon: HandshakeRounded,
  },
  {
    key: 'government',
    label: 'Government',
    keywords: ['civic', 'institution', 'public'],
    icon: AccountBalanceRounded,
  },
  { key: 'vote', label: 'Vote', keywords: ['election', 'civic', 'ballot'], icon: HowToVoteRounded },
  {
    key: 'community',
    label: 'Community',
    keywords: ['people', 'coalition', 'diversity'],
    icon: Diversity3Rounded,
  },
  { key: 'hub', label: 'Hub', keywords: ['network', 'connected', 'center'], icon: HubRounded },
  {
    key: 'psychology',
    label: 'Psychology',
    keywords: ['thinking', 'mind', 'research'],
    icon: PsychologyRounded,
  },
  {
    key: 'idea',
    label: 'Idea',
    keywords: ['lightbulb', 'innovation', 'concept'],
    icon: LightbulbRounded,
  },
  {
    key: 'launch',
    label: 'Launch',
    keywords: ['rocket', 'start', 'release'],
    icon: RocketLaunchRounded,
  },
  {
    key: 'language',
    label: 'Language',
    keywords: ['translation', 'global', 'communication'],
    icon: LanguageRounded,
  },
  {
    key: 'park',
    label: 'Park',
    keywords: ['nature', 'public space', 'environment'],
    icon: ParkRounded,
  },
  {
    key: 'building',
    label: 'Building',
    keywords: ['organization', 'city', 'office'],
    icon: ApartmentRounded,
  },
  {
    key: 'engineering',
    label: 'Engineering',
    keywords: ['technical', 'infrastructure'],
    icon: EngineeringRounded,
  },
  {
    key: 'construction',
    label: 'Construction',
    keywords: ['build', 'infrastructure', 'work'],
    icon: ConstructionRounded,
  },
  {
    key: 'timeline',
    label: 'Timeline',
    keywords: ['plan', 'schedule', 'history'],
    icon: TimelineRounded,
  },
  {
    key: 'analytics',
    label: 'Analytics',
    keywords: ['data', 'metrics', 'report'],
    icon: AnalyticsRounded,
  },
  {
    key: 'insights',
    label: 'Insights',
    keywords: ['data', 'learning', 'analysis'],
    icon: InsightsRounded,
  },
  {
    key: 'growth',
    label: 'Growth',
    keywords: ['trend', 'progress', 'increase'],
    icon: TrendingUpRounded,
  },
  {
    key: 'verified',
    label: 'Verified',
    keywords: ['check', 'approved', 'quality'],
    icon: VerifiedRounded,
  },
  {
    key: 'security',
    label: 'Security',
    keywords: ['shield', 'safety', 'protection'],
    icon: SecurityRounded,
  },
  { key: 'energy', label: 'Energy', keywords: ['bolt', 'power', 'fast'], icon: BoltRounded },
  {
    key: 'favorite',
    label: 'Favorite',
    keywords: ['heart', 'care', 'support'],
    icon: FavoriteRounded,
  },
  { key: 'star', label: 'Star', keywords: ['favorite', 'featured', 'priority'], icon: StarRounded },
  {
    key: 'explore',
    label: 'Explore',
    keywords: ['compass', 'discover', 'direction'],
    icon: ExploreRounded,
  },
  {
    key: 'travel',
    label: 'Travel',
    keywords: ['explore', 'regional', 'trip'],
    icon: TravelExploreRounded,
  },
  {
    key: 'award',
    label: 'Award',
    keywords: ['achievement', 'recognition', 'premium'],
    icon: WorkspacePremiumRounded,
  },
  {
    key: 'volunteering',
    label: 'Volunteering',
    keywords: ['service', 'care', 'community'],
    icon: VolunteerActivismRounded,
  },
  {
    key: 'forum',
    label: 'Forum',
    keywords: ['conversation', 'community', 'discussion'],
    icon: ForumRounded,
  },
  {
    key: 'voice',
    label: 'Voice',
    keywords: ['speaker', 'public', 'outreach'],
    icon: RecordVoiceOverRounded,
  },
  {
    key: 'podcast',
    label: 'Podcast',
    keywords: ['media', 'audio', 'broadcast'],
    icon: PodcastsRounded,
  },
  {
    key: 'article',
    label: 'Article',
    keywords: ['document', 'writing', 'media'],
    icon: ArticleRounded,
  },
  {
    key: 'policy',
    label: 'Policy',
    keywords: ['rules', 'government', 'document'],
    icon: PolicyRounded,
  },
  {
    key: 'justice',
    label: 'Justice',
    keywords: ['law', 'government', 'accountability'],
    icon: GavelRounded,
  },
  {
    key: 'library',
    label: 'Library',
    keywords: ['books', 'education', 'community'],
    icon: LocalLibraryRounded,
  },
  {
    key: 'pedestrian',
    label: 'Pedestrian',
    keywords: ['people', 'walking', 'street'],
    icon: EmojiPeopleRounded,
  },
] as const satisfies readonly StrategicWorkRoundedIconOption[];

/** Rounded icon component lookup for every persisted display key. */
export const STRATEGIC_WORK_ROUNDED_ICON_BY_KEY = Object.fromEntries(
  STRATEGIC_WORK_ROUNDED_ICON_OPTIONS.map((option) => [option.key, option.icon]),
) as Record<EntityDisplayIconKey, typeof SvgIcon>;
