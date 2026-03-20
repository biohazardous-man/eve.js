const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));

class ItemLockingService extends BaseService {
  constructor() {
    super("itemLocking");
  }

  Handle_GetItemsByLocation(args, session, kwargs) {
    return [];
  }

  Handle_GetLockedItemLocations(args, session, kwargs) {
    return [];
  }
}

module.exports = ItemLockingService;
