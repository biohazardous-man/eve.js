const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizePositiveInteger(value, fallback = null) {
  const numeric = normalizeInteger(value, 0);
  return numeric > 0 ? numeric : fallback;
}

class OwnerGroupManagerService extends BaseService {
  constructor() {
    super("ownerGroupManager");
  }

  Handle_GetMyGroups() {
    return [];
  }

  Handle_GetGroup(args) {
    const groupID = normalizePositiveInteger(args && args[0], null);
    if (!groupID) {
      return null;
    }
    return null;
  }

  Handle_GetGroupsMany(args) {
    const groupIDs = Array.isArray(args && args[0]) ? args[0] : [];
    return groupIDs
      .map((groupID) => normalizePositiveInteger(groupID, null))
      .filter(Boolean)
      .map(() => null);
  }

  Handle_GetMembers() {
    return [];
  }

  Handle_GetMembersForMultipleGroups() {
    return {};
  }

  Handle_GetGroupLogs() {
    return [];
  }

  Handle_GetPublicGroupInfo() {
    return null;
  }

  Handle_SearchGroups() {
    return [];
  }

  Handle_GetMyGroupsAndMembers() {
    return {
      groups: [],
      membersByGroupID: {},
    };
  }

  Handle_GetMyGroupsToUseForBookmarks() {
    return [];
  }

  Handle_CreateGroup() {
    return null;
  }

  Handle_UpdateGroup() {
    return null;
  }

  Handle_DeleteGroup() {
    return false;
  }

  Handle_AddMembers() {
    return [];
  }

  Handle_RemoveMembers() {
    return [];
  }

  Handle_UpdateMemberships(args) {
    return cloneValue(Array.isArray(args && args[0]) ? args[0] : []);
  }
}

module.exports = OwnerGroupManagerService;
