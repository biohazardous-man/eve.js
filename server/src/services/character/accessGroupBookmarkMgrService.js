const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildKeyVal,
  buildList,
  extractDictEntries,
  extractList,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const runtime = require(path.join(__dirname, "../bookmark/bookmarkRuntimeState"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const {
  resolveLocationBookmarkTarget,
} = require(path.join(__dirname, "../bookmark/bookmarkTargetResolver"));
const {
  buildBookmarkDict,
  buildBookmarkPayload,
  buildFolderPayload,
  buildSubfolderPayload,
} = require(path.join(__dirname, "../bookmark/bookmarkPayloads"));
const notifications = require(path.join(__dirname, "../bookmark/bookmarkNotifications"));
const {
  TYPE_SOLAR_SYSTEM,
} = require(path.join(__dirname, "../bookmark/bookmarkConstants"));

function getCharacterID(session) {
  return Number(session && session.characterID) || 0;
}

function getKwargValue(kwargs, key) {
  const entries = extractDictEntries(kwargs);
  const match = entries.find(([entryKey]) => String(entryKey) === String(key));
  return match ? match[1] : null;
}

function buildFolderViewPayload(view) {
  return buildFolderPayload(view.folder, {
    accessLevel: view.accessLevel,
    isActive: view.isActive,
  });
}

function buildFolderList(views = []) {
  return buildList((Array.isArray(views) ? views : []).map(buildFolderViewPayload));
}

function buildBookmarkList(bookmarks = []) {
  return buildList((Array.isArray(bookmarks) ? bookmarks : []).map(buildBookmarkPayload));
}

function buildSubfolderList(subfolders = []) {
  return buildList((Array.isArray(subfolders) ? subfolders : []).map(buildSubfolderPayload));
}

function buildBookmarkReplyTuple(bookmark = {}) {
  return [
    normalizeNumber(bookmark.bookmarkID, 0),
    bookmark.itemID || null,
    normalizeNumber(bookmark.typeID, TYPE_SOLAR_SYSTEM),
    bookmark.x == null ? null : Number(bookmark.x),
    bookmark.y == null ? null : Number(bookmark.y),
    bookmark.z == null ? null : Number(bookmark.z),
    normalizeNumber(bookmark.locationID, 0),
    bookmark.expiry ? { type: "long", value: BigInt(bookmark.expiry) } : null,
  ];
}

function throwBookmarkServiceError(error) {
  const code = String(
    (error && error.bookmarkError) ||
    (error && error.message) ||
    "BOOKMARK_ERROR",
  );

  switch (code) {
    case "BookmarkFolderNoLongerThere":
    case "FolderAccessDenied":
    case "BookmarkSubfolderNoLongerThere":
    case "CouldNotDeleteBookmarksInSubfolder":
    case "BookmarkNotAvailable":
    case "TooManyKnownFolders":
    case "TooManyActiveFolders":
    case "AdminAccessRequired":
      throwWrappedUserError(code);
      break;
    default:
      throwWrappedUserError("CustomNotify", {
        notify: `Bookmark error: ${code}`,
      });
      break;
  }
}

class AccessGroupBookmarkMgrService extends BaseService {
  constructor() {
    super("accessGroupBookmarkMgr");
  }

  Handle_GetMyActiveBookmarks(args, session) {
    try {
      const result = runtime.getMyActiveBookmarks(getCharacterID(session));
      return [
        buildFolderList(result.folders),
        buildBookmarkList(result.bookmarks),
        buildSubfolderList(result.subfolders),
      ];
    } catch (error) {
      throwBookmarkServiceError(error);
    }
  }

  Handle_AddFolder(args, session) {
    try {
      const view = runtime.addFolder(getCharacterID(session), {
        isPersonal: args && args[0],
        folderName: args && args[1],
        description: args && args[2],
        adminGroupID: args && args[3],
        manageGroupID: args && args[4],
        useGroupID: args && args[5],
        viewGroupID: args && args[6],
      });
      return buildFolderViewPayload(view);
    } catch (error) {
      throwBookmarkServiceError(error);
    }
  }

  Handle_UpdateFolder(args, session) {
    try {
      const result = runtime.updateFolder(getCharacterID(session), args && args[0], {
        folderName: args && args[1],
        description: args && args[2],
        adminGroupID: args && args[3],
        manageGroupID: args && args[4],
        useGroupID: args && args[5],
        viewGroupID: args && args[6],
      });
      if (result && result.folder && result.folder.isPersonal === false) {
        notifications.notifyFolderUpdated(result.folder.folderID, result.folder, {
          excludeCharacterID: getCharacterID(session),
        });
      }
      return normalizeNumber(result && result.accessLevel, 0);
    } catch (error) {
      throwBookmarkServiceError(error);
    }
  }

  Handle_DeleteFolder(args, session) {
    try {
      const result = runtime.deleteFolder(getCharacterID(session), args && args[0]);
      if (result && result.folder && result.folder.isPersonal === false) {
        notifications.notifyFolderDeleted(result.folder.folderID, {
          excludeCharacterID: getCharacterID(session),
        });
      }
      return true;
    } catch (error) {
      throwBookmarkServiceError(error);
    }
  }

  Handle_AddToKnownFolders(args, session) {
    try {
      const result = runtime.addKnownFolder(getCharacterID(session), args && args[0], args && args[1]);
      return [
        buildFolderViewPayload(result.folder),
        buildBookmarkList(result.bookmarks),
        buildSubfolderList(result.subfolders),
      ];
    } catch (error) {
      throwBookmarkServiceError(error);
    }
  }

  Handle_RemoveFromKnownFolders(args, session) {
    try {
      runtime.removeKnownFolder(getCharacterID(session), args && args[0]);
      return true;
    } catch (error) {
      throwBookmarkServiceError(error);
    }
  }

  Handle_UpdateKnownFolderState(args, session) {
    try {
      const result = runtime.updateKnownFolderState(getCharacterID(session), args && args[0], args && args[1]);
      return [
        buildFolderViewPayload(result.folder),
        buildBookmarkList(result.bookmarks),
        buildSubfolderList(result.subfolders),
      ];
    } catch (error) {
      throwBookmarkServiceError(error);
    }
  }

  Handle_GetFolderInfo(args, session) {
    try {
      return buildFolderViewPayload(runtime.getFolderInfo(getCharacterID(session), args && args[0]));
    } catch (error) {
      throwBookmarkServiceError(error);
    }
  }

  Handle_CreateSubfolder(args, session) {
    try {
      const subfolder = runtime.createSubfolder(getCharacterID(session), args && args[0], args && args[1]);
      const folderInfo = runtime.getFolderInfo(getCharacterID(session), args && args[0]);
      if (folderInfo.folder.isPersonal === false) {
        notifications.notifySubfolderAdded(folderInfo.folder.folderID, subfolder, {
          excludeCharacterID: getCharacterID(session),
        });
      }
      return buildSubfolderPayload(subfolder);
    } catch (error) {
      throwBookmarkServiceError(error);
    }
  }

  Handle_UpdateSubfolder(args, session) {
    try {
      const updated = runtime.updateSubfolder(getCharacterID(session), args && args[0], args && args[1], args && args[2]) === true;
      const folder = runtime.getFolderInfo(getCharacterID(session), args && args[0]);
      if (updated && folder.folder.isPersonal === false) {
        notifications.notifySubfolderUpdated(folder.folder.folderID, args && args[1], args && args[2], {
          excludeCharacterID: getCharacterID(session),
        });
      }
      return updated;
    } catch (error) {
      throwBookmarkServiceError(error);
    }
  }

  Handle_DeleteSubfolder(args, session) {
    try {
      const folder = runtime.getFolderInfo(getCharacterID(session), args && args[0]);
      const deletedBookmarkIDs = runtime.deleteSubfolder(getCharacterID(session), args && args[0], args && args[1]);
      if (folder.folder.isPersonal === false) {
        notifications.notifySubfolderRemoved(folder.folder.folderID, args && args[1], {
          excludeCharacterID: getCharacterID(session),
        });
        notifications.notifyBookmarksRemoved(folder.folder.folderID, deletedBookmarkIDs, {
          excludeCharacterID: getCharacterID(session),
        });
      }
      return buildList(deletedBookmarkIDs);
    } catch (error) {
      throwBookmarkServiceError(error);
    }
  }

  Handle_BookmarkStaticLocation(args, session, kwargs) {
    try {
      const target = runtime.resolveStaticBookmarkTarget(args && args[0], session);
      if (!target) {
        throw new Error("BookmarkFolderNoLongerThere");
      }
      const result = runtime.createBookmark(getCharacterID(session), {
        folderID: args && args[1],
        memo: args && args[2],
        note: args && args[3],
        expiryMode: args && args[4],
        subfolderID: getKwargValue(kwargs, "subfolderID"),
        ...target,
      });
      const bookmark = result.bookmark;
      if (result.folder && result.folder.isPersonal === false) {
        notifications.notifyBookmarksAdded(result.folder.folderID, [bookmark], {
          excludeCharacterID: getCharacterID(session),
        });
      }
      return buildBookmarkReplyTuple(bookmark);
    } catch (error) {
      throwBookmarkServiceError(error);
    }
  }

  Handle_BookmarkLocation(args, session, kwargs) {
    try {
      const itemID = normalizeNumber(args && args[0], 0);
      const folderID = normalizeNumber(args && args[1], 0);
      const scene = spaceRuntime.getSceneForSession(session);
      const target = resolveLocationBookmarkTarget(itemID, session, scene);

      if (!target) {
        throw new Error("BookmarkNotAvailable");
      }

      const result = runtime.createBookmark(getCharacterID(session), {
        folderID,
        memo: args && args[2],
        note: args && args[3],
        expiryMode: args && args[4],
        subfolderID: getKwargValue(kwargs, "subfolderID"),
        ...target,
      });
      if (result.folder && result.folder.isPersonal === false) {
        notifications.notifyBookmarksAdded(result.folder.folderID, [result.bookmark], {
          excludeCharacterID: getCharacterID(session),
        });
      }
      return buildBookmarkReplyTuple(result.bookmark);
    } catch (error) {
      throwBookmarkServiceError(error);
    }
  }

  Handle_BookmarkScanResult(args, session, kwargs) {
    try {
      const target = runtime.resolveScanBookmarkTarget(args && args[0], args && args[3]);
      if (!target) {
        throw new Error("BookmarkNotAvailable");
      }
      const result = runtime.createBookmark(getCharacterID(session), {
        folderID: args && args[4],
        memo: args && args[1],
        note: args && args[2],
        expiryMode: args && args[5],
        subfolderID: getKwargValue(kwargs, "subfolderID"),
        ...target,
      });
      if (result.folder && result.folder.isPersonal === false) {
        notifications.notifyBookmarksAdded(result.folder.folderID, [result.bookmark], {
          excludeCharacterID: getCharacterID(session),
        });
      }
      return buildBookmarkReplyTuple(result.bookmark);
    } catch (error) {
      throwBookmarkServiceError(error);
    }
  }

  Handle_UpdateBookmark(args, session) {
    try {
      const result = runtime.updateBookmark(
        getCharacterID(session),
        args && args[0],
        args && args[1],
        args && args[2],
        args && args[3],
        args && args[4],
        args && args[5],
        args && args[6],
      );
      const bookmark = result && result.bookmark ? result.bookmark : null;
      if (bookmark) {
        if (result.oldFolderID !== result.newFolderID) {
          notifications.notifyBookmarksMoved(result.oldFolderID, result.newFolderID, [bookmark], {
            excludeCharacterID: getCharacterID(session),
          });
        } else {
          const folder = runtime.getFolderInfo(getCharacterID(session), result.newFolderID);
          if (folder.folder.isPersonal === false) {
            notifications.notifyBookmarksUpdated(result.newFolderID, [bookmark], {
              excludeCharacterID: getCharacterID(session),
            });
          }
        }
      }
      return true;
    } catch (error) {
      throwBookmarkServiceError(error);
    }
  }

  Handle_DeleteBookmarks(args, session) {
    try {
      const folder = runtime.getFolderInfo(getCharacterID(session), args && args[0]);
      const deletedBookmarkIDs = runtime.deleteBookmarks(getCharacterID(session), args && args[0], extractList(args && args[1]));
      if (folder.folder.isPersonal === false) {
        notifications.notifyBookmarksRemoved(folder.folder.folderID, deletedBookmarkIDs, {
          excludeCharacterID: getCharacterID(session),
        });
      }
      return buildList(deletedBookmarkIDs);
    } catch (error) {
      throwBookmarkServiceError(error);
    }
  }

  Handle_MoveBookmarksToFolderAndSubfolder(args, session) {
    try {
      const result = runtime.moveBookmarks(getCharacterID(session), args && args[0], args && args[1], args && args[2], extractList(args && args[3]));
      notifications.notifyBookmarksMoved(result.oldFolderID, result.newFolderID, result.movedBookmarks, {
        excludeCharacterID: getCharacterID(session),
      });
      return [
        buildList(
          result.movedBookmarks.map((bookmark) =>
            buildKeyVal([
              ["bookmarkID", bookmark.bookmarkID],
              ["folderID", bookmark.folderID],
              ["subfolderID", bookmark.subfolderID],
            ]),
          ),
        ),
        null,
      ];
    } catch (error) {
      throwBookmarkServiceError(error);
    }
  }

  Handle_CopyBookmarksToFolderAndSubfolder(args, session) {
    try {
      const bookmarks = runtime.copyBookmarks(getCharacterID(session), args && args[0], args && args[1], args && args[2], extractList(args && args[3]));
      const folder = runtime.getFolderInfo(getCharacterID(session), args && args[1]);
      if (folder.folder.isPersonal === false) {
        notifications.notifyBookmarksAdded(folder.folder.folderID, bookmarks, {
          excludeCharacterID: getCharacterID(session),
        });
      }
      return [buildBookmarkDict(bookmarks), null];
    } catch (error) {
      throwBookmarkServiceError(error);
    }
  }

  Handle_SearchFoldersWithAdminAccess(args, session) {
    try {
      return buildFolderList(runtime.listFoldersWithAdminAccess(getCharacterID(session)));
    } catch (error) {
      throwBookmarkServiceError(error);
    }
  }
}

module.exports = AccessGroupBookmarkMgrService;
