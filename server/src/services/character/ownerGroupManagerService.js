const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const runtime = require(path.join(__dirname, "../bookmark/bookmarkRuntimeState"));
const {
  buildGroupPayload,
} = require(path.join(__dirname, "../bookmark/bookmarkPayloads"));

function getCharacterID(session) {
  return Number(session && session.characterID) || 0;
}

function buildGroupList(groups = []) {
  return (Array.isArray(groups) ? groups : []).map(buildGroupPayload);
}

class OwnerGroupManagerService extends BaseService {
  constructor() {
    super("ownerGroupManager");
  }

  Handle_GetMyGroups(args, session) {
    return buildGroupList(runtime.listGroupsForCharacter(getCharacterID(session)));
  }

  Handle_GetGroup(args, session) {
    const group = runtime.getGroupForCharacter(getCharacterID(session), args && args[0]);
    return group ? buildGroupPayload(group) : null;
  }

  Handle_GetGroupsMany(args, session) {
    return buildGroupList(
      runtime.getGroupsManyForCharacter(
        getCharacterID(session),
        Array.isArray(args && args[0]) ? args[0] : [],
      ),
    );
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

  Handle_GetPublicGroupInfo(args, session) {
    const group = runtime.getGroupForCharacter(getCharacterID(session), args && args[0]);
    return group ? buildGroupPayload(group) : null;
  }

  Handle_SearchGroups(args, session) {
    return buildGroupList(runtime.listGroupsForCharacter(getCharacterID(session)));
  }

  Handle_GetMyGroupsAndMembers(args, session) {
    return {
      groups: buildGroupList(runtime.listGroupsForCharacter(getCharacterID(session))),
      membersByGroupID: {},
    };
  }

  Handle_GetMyGroupsToUseForBookmarks(args, session) {
    return buildGroupList(runtime.listGroupsForCharacter(getCharacterID(session)));
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
    return Array.isArray(args && args[0]) ? args[0] : [];
  }
}

module.exports = OwnerGroupManagerService;
