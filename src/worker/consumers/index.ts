// One side-effect import per feature module that calls registerJob, registerRepeatable or
// registerFeedConsumer. Later parts add one import line each.
import "../feed-prune";
import "../jobs/retention";
import "../jobs/discord";
import "../jobs/dispatch";
import "../jobs/push";
import "./notifications";
import "./discord";
import "../github/events";
import "../github/prune";
import "../github/installations";
import "../github/pulls";
import "../github/checks";
import "./realtime";
