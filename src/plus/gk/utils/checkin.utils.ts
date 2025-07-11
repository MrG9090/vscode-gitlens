import type { GKCheckInResponse, GKLicense, GKLicenseType } from '../models/checkin';
import type { Organization } from '../models/organization';
import type { Subscription, SubscriptionPlanIds } from '../models/subscription';
import { compareSubscriptionPlans, getSubscriptionPlan, getSubscriptionPlanOrder } from './subscription.utils';

export function getSubscriptionFromCheckIn(
	data: GKCheckInResponse,
	organizations: Organization[],
	organizationId?: string,
): Omit<Subscription, 'state' | 'lastValidatedAt'> {
	const account: Subscription['account'] = {
		id: data.user.id,
		name: data.user.name,
		email: data.user.email,
		verified: data.user.status === 'activated',
		createdOn: data.user.createdDate,
	};

	let effectiveLicenses = Object.entries(data.licenses.effectiveLicenses) as [GKLicenseType, GKLicense][];
	let paidLicenses = Object.entries(data.licenses.paidLicenses) as [GKLicenseType, GKLicense][];
	paidLicenses = paidLicenses.filter(
		license => license[1].latestStatus !== 'expired' && license[1].latestStatus !== 'cancelled',
	);
	if (paidLicenses.length > 1) {
		paidLicenses.sort(
			(a, b) =>
				getSubscriptionPlanOrder(convertLicenseTypeToPlanId(b[0])) +
				licenseStatusPriority(b[1].latestStatus) -
				(getSubscriptionPlanOrder(convertLicenseTypeToPlanId(a[0])) + licenseStatusPriority(a[1].latestStatus)),
		);
	}
	if (effectiveLicenses.length > 1) {
		effectiveLicenses.sort(
			(a, b) =>
				getSubscriptionPlanOrder(convertLicenseTypeToPlanId(b[0])) +
				licenseStatusPriority(b[1].latestStatus) -
				(getSubscriptionPlanOrder(convertLicenseTypeToPlanId(a[0])) + licenseStatusPriority(a[1].latestStatus)),
		);
	}

	const effectiveLicensesByOrganizationId = new Map<string, [GKLicenseType, GKLicense]>();
	const paidLicensesByOrganizationId = new Map<string, [GKLicenseType, GKLicense]>();
	for (const licenseData of effectiveLicenses) {
		const [, license] = licenseData;
		if (license.organizationId == null) continue;
		const existingLicense = effectiveLicensesByOrganizationId.get(license.organizationId);
		if (existingLicense == null) {
			effectiveLicensesByOrganizationId.set(license.organizationId, licenseData);
		}
	}

	for (const licenseData of paidLicenses) {
		const [, license] = licenseData;
		if (license.organizationId == null) continue;
		const existingLicense = paidLicensesByOrganizationId.get(license.organizationId);
		if (existingLicense == null) {
			paidLicensesByOrganizationId.set(license.organizationId, licenseData);
		}
	}

	const organizationsWithNoLicense = organizations.filter(
		organization =>
			!paidLicensesByOrganizationId.has(organization.id) &&
			!effectiveLicensesByOrganizationId.has(organization.id),
	);

	if (organizationId != null) {
		paidLicenses = paidLicenses.filter(
			([, license]) => license.organizationId === organizationId || license.organizationId == null,
		);
		effectiveLicenses = effectiveLicenses.filter(
			([, license]) => license.organizationId === organizationId || license.organizationId == null,
		);
	}

	let actual: Subscription['plan']['actual'] | undefined;
	const bestPaidLicense = paidLicenses.length > 0 ? paidLicenses[0] : undefined;
	const bestEffectiveLicense = effectiveLicenses.length > 0 ? effectiveLicenses[0] : undefined;
	const chosenPaidLicense =
		organizationId != null
			? (paidLicensesByOrganizationId.get(organizationId) ?? bestPaidLicense)
			: bestPaidLicense;
	if (chosenPaidLicense != null) {
		const [licenseType, license] = chosenPaidLicense;
		actual = getSubscriptionPlan(
			convertLicenseTypeToPlanId(licenseType),
			isBundleLicenseType(licenseType),
			license.reactivationCount ?? 0,
			license.organizationId,
			new Date(license.latestStartDate),
			new Date(license.latestEndDate),
		);
	}

	if (actual == null) {
		actual = getSubscriptionPlan(
			'community-with-account',
			false,
			0,
			undefined,
			data.user.firstGitLensCheckIn != null
				? new Date(data.user.firstGitLensCheckIn)
				: data.user.createdDate != null
					? new Date(data.user.createdDate)
					: undefined,
			undefined,
			undefined,
			data.nextOptInDate,
		);
	}

	let effective: Subscription['plan']['effective'] | undefined;
	const chosenEffectiveLicense =
		organizationId != null
			? (effectiveLicensesByOrganizationId.get(organizationId) ?? bestEffectiveLicense)
			: bestEffectiveLicense;
	if (chosenEffectiveLicense != null) {
		const [licenseType, license] = chosenEffectiveLicense;
		effective = getSubscriptionPlan(
			convertLicenseTypeToPlanId(licenseType),
			isBundleLicenseType(licenseType),
			license.reactivationCount ?? 0,
			license.organizationId,
			new Date(license.latestStartDate),
			new Date(license.latestEndDate),
			license.latestStatus === 'cancelled',
			license.nextOptInDate ?? data.nextOptInDate,
		);
	}

	if (effective == null || compareSubscriptionPlans(actual.id, effective.id) >= 0) {
		effective = { ...actual };
	}

	let activeOrganization: Organization | undefined;
	if (organizationId != null) {
		activeOrganization = organizations.find(organization => organization.id === organizationId);
	} else if (effective?.organizationId != null) {
		activeOrganization = organizations.find(organization => organization.id === effective.organizationId);
	} else if (organizationsWithNoLicense.length > 0) {
		activeOrganization = organizationsWithNoLicense[0];
	}

	return {
		plan: {
			actual: actual,
			effective: effective,
		},
		account: account,
		activeOrganization: activeOrganization,
	};
}
function convertLicenseTypeToPlanId(licenseType: GKLicenseType): SubscriptionPlanIds {
	switch (licenseType) {
		case 'gitlens-pro':
		case 'bundle-pro':
		case 'gitkraken_v1-pro':
		case 'gitkraken-v1-pro':
			return 'pro';
		case 'gitlens-teams':
		case 'bundle-teams':
		case 'gitkraken_v1-teams':
		case 'gitkraken-v1-teams':
			return 'teams';
		case 'gitlens-advanced':
		case 'bundle-advanced':
		case 'gitkraken_v1-advanced':
		case 'gitkraken-v1-advanced':
			return 'advanced';
		case 'gitlens-hosted-enterprise':
		case 'gitlens-self-hosted-enterprise':
		case 'gitlens-standalone-enterprise':
		case 'bundle-hosted-enterprise':
		case 'bundle-self-hosted-enterprise':
		case 'bundle-standalone-enterprise':
		case 'gitkraken_v1-hosted-enterprise':
		case 'gitkraken_v1-self-hosted-enterprise':
		case 'gitkraken_v1-standalone-enterprise':
		case 'gitkraken-v1-hosted-enterprise':
		case 'gitkraken-v1-self-hosted-enterprise':
		case 'gitkraken-v1-standalone-enterprise':
			return 'enterprise';
		default:
			return 'pro';
	}
}
function isBundleLicenseType(licenseType: GKLicenseType): boolean {
	switch (licenseType) {
		case 'bundle-pro':
		case 'bundle-advanced':
		case 'bundle-teams':
		case 'bundle-hosted-enterprise':
		case 'bundle-self-hosted-enterprise':
		case 'bundle-standalone-enterprise':
			return true;
		default:
			return false;
	}
}
function licenseStatusPriority(status: GKLicense['latestStatus']): number {
	switch (status) {
		case 'active':
			return 100;
		case 'expired':
		case 'cancelled':
			return -100;
		case 'in_trial':
		case 'trial':
			return 1;
		case 'canceled':
		case 'non_renewing':
			return 0;
		default:
			return -200;
	}
}
