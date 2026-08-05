import { randomUUID } from 'crypto';
import {
  listWalletsForAdmin,
  getWalletLiability,
  getUserLedgerForAdmin,
  adminAdjustWallet,
  setWalletStatus,
  getWalletReconciliation,
  getWallet,
  WalletError,
} from '../../services/wallet/wallet.service.js';
import * as response from '../../utils/responses.js';
import { logError, logInfo } from '../../utils/logger.js';

function resolveKobo(body) {
  if (body?.amount_kobo != null) {
    const k = Number(body.amount_kobo);
    return Number.isFinite(k) ? Math.round(k) : null;
  }
  if (body?.amount != null) {
    const n = Number(body.amount);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }
  return null;
}

// GET /admin/wallets?page=&limit=&search=
export const listWallets = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const search = req.query.search?.trim() || undefined;
    const [list, liability] = await Promise.all([
      listWalletsForAdmin({ page, limit, search }),
      getWalletLiability(),
    ]);
    return response.success(res, {
      wallets: list.wallets,
      pagination: { total: list.total, page, limit, totalPages: Math.max(1, Math.ceil(list.total / limit)) },
      stats: {
        total_liability_kobo: liability.total_liability_kobo,
        total_liability_naira: liability.total_liability_kobo / 100,
        wallet_count: liability.wallet_count,
      },
    }, 'Wallets retrieved');
  } catch (error) {
    logError('[Admin Wallets] list error', { error: error.message });
    return response.serverError(res, 'Failed to retrieve wallets');
  }
};

// GET /admin/wallets/reconciliation
export const getReconciliation = async (req, res) => {
  try {
    const report = await getWalletReconciliation();
    return response.success(res, report, 'Reconciliation report');
  } catch (error) {
    logError('[Admin Wallets] reconciliation error', { error: error.message });
    return response.serverError(res, 'Failed to run reconciliation');
  }
};

// GET /admin/wallets/:userId/ledger
export const getUserLedger = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const [wallet, ledger] = await Promise.all([
      getWallet(userId),
      getUserLedgerForAdmin(userId, { page, limit }),
    ]);
    return response.success(res, {
      wallet: { balance_kobo: wallet.balance_kobo, status: wallet.status, currency: wallet.currency },
      entries: ledger.entries,
      pagination: { total: ledger.total, page, limit },
    }, 'Ledger retrieved');
  } catch (error) {
    logError('[Admin Wallets] ledger error', { error: error.message });
    return response.serverError(res, 'Failed to retrieve ledger');
  }
};

// POST /admin/wallets/:userId/adjust  { direction, amount_kobo, reason }
export const adjustWallet = async (req, res) => {
  try {
    const { userId } = req.params;
    const { direction, reason } = req.body;
    const amountKobo = resolveKobo(req.body);

    if (!['credit', 'debit'].includes(direction)) {
      return response.error(res, 'direction must be "credit" or "debit"', 400);
    }
    if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
      return response.error(res, 'A positive amount is required', 400);
    }
    if (!reason || !String(reason).trim()) {
      return response.error(res, 'A reason is required for every adjustment', 400);
    }

    const result = await adminAdjustWallet({
      userId,
      direction,
      amountKobo,
      adminId: req.admin.id,
      note: String(reason).trim().slice(0, 500),
      reference: `ADJ-${randomUUID()}`,
    });

    logInfo('[Admin Wallets] adjustment', { userId, direction, amountKobo, adminId: req.admin.id, balanceAfter: result.balanceAfter });
    return response.success(res, {
      direction,
      amount_kobo: amountKobo,
      balance_kobo: result.balanceAfter,
      balance_naira: result.balanceAfter / 100,
    }, `Wallet ${direction === 'credit' ? 'credited' : 'debited'} successfully`);
  } catch (error) {
    if (error instanceof WalletError) return response.error(res, error.message, error.statusCode || 500);
    logError('[Admin Wallets] adjust error', { error: error.message });
    return response.serverError(res, 'Failed to adjust wallet');
  }
};

// POST /admin/wallets/:userId/status  { status: 'active' | 'frozen' }
export const updateWalletStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body;
    if (!['active', 'frozen'].includes(status)) {
      return response.error(res, 'status must be "active" or "frozen"', 400);
    }
    await setWalletStatus(userId, status);
    logInfo('[Admin Wallets] status change', { userId, status, adminId: req.admin.id });
    return response.success(res, { user_id: userId, status }, `Wallet ${status === 'frozen' ? 'frozen' : 'unfrozen'}`);
  } catch (error) {
    if (error instanceof WalletError) return response.error(res, error.message, error.statusCode || 500);
    logError('[Admin Wallets] status error', { error: error.message });
    return response.serverError(res, 'Failed to update wallet status');
  }
};
