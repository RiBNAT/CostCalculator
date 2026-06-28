package service

import (
	"context"

	"costcalculator/backend/internal/domain"
	"costcalculator/backend/internal/repo"
)

// SeedDefaults creates the default categories and accounts extracted from the
// CostSheet workbook's data sheet for a newly registered user.
func SeedDefaults(ctx context.Context, db *repo.DB, userID string) error {
	return db.WithTransaction(ctx, func(txCtx context.Context) error {
		return seedDefaults(txCtx, db, userID)
	})
}

func seedDefaults(ctx context.Context, db *repo.DB, userID string) error {
	subs := func(names ...string) []domain.Subcategory {
		out := make([]domain.Subcategory, len(names))
		for i, n := range names {
			out[i] = domain.Subcategory{Name: n, Active: true}
		}
		return out
	}
	categories := []domain.Category{
		{Name: "RentAndPaybill", Kind: domain.CategoryExpense,
			Subcategories: subs("HouseRent", "ElectricBill_Dhk", "ElectricBill_Swk", "GassBill", "WifiBill", "ServiceBill")},
		{Name: "Bazar", Kind: domain.CategoryExpense,
			Subcategories: subs("DailyBazar", "Fruits", "AdvGiven", "Others")},
		{Name: "HouseholdAccessories", Kind: domain.CategoryExpense,
			Subcategories: subs("HouseholdAccessories", "DailyAccessories", "Medicine")},
		{Name: "MobileInternet", Kind: domain.CategoryExpense,
			Subcategories: subs("ForMine", "ForOthers")},
		{Name: "ExtraExpenses", Kind: domain.CategoryExpense,
			Subcategories: subs("Tea", "Travel", "AiSubs", "BooksOrCourses", "ExtraExpenses")},
		{Name: "Savings", Kind: domain.CategorySavings,
			Subcategories: subs("EximBank_2.5", "CityBank_10", "BracBank_10", "SBL_root", "Exim_root")},
		{Name: "Donation", Kind: domain.CategoryExpense,
			Subcategories: subs("Donation", "Unknown")},
		{Name: "Pay", Kind: domain.CategoryPay,
			Subcategories: subs("CityService", "SblService", "BracService")},
	}
	for i := range categories {
		categories[i].ID = repo.NewID()
		categories[i].UserID = userID
		categories[i].Active = true
		if _, err := db.Categories.InsertOne(ctx, categories[i]); err != nil {
			return err
		}
	}

	accounts := []domain.Account{
		{Name: "Cash", Kind: domain.AccountCash},
		{Name: "SCB", Kind: domain.AccountBank},
		{Name: "SBL", Kind: domain.AccountBank},
		{Name: "EXIM", Kind: domain.AccountBank},
		{Name: "City", Kind: domain.AccountBank},
		{Name: "bKash", Kind: domain.AccountMobile},
		{Name: "Nagad", Kind: domain.AccountMobile},
		{Name: "Add", Kind: domain.AccountVirtual, VirtualRole: domain.RoleExternal},
		{Name: "LendGiven", Kind: domain.AccountVirtual, VirtualRole: domain.RoleLendGiven},
		{Name: "LendTaken", Kind: domain.AccountVirtual, VirtualRole: domain.RoleLendTaken},
		{Name: "EximBank_2.5", Kind: domain.AccountSavings},
		{Name: "CityBank_10", Kind: domain.AccountSavings},
		{Name: "BracBank_10", Kind: domain.AccountSavings},
		{Name: "SBL_root", Kind: domain.AccountSavings},
		{Name: "Exim_root", Kind: domain.AccountSavings},
	}
	for i := range accounts {
		accounts[i].ID = repo.NewID()
		accounts[i].UserID = userID
		accounts[i].Active = true
		if _, err := db.Accounts.InsertOne(ctx, accounts[i]); err != nil {
			return err
		}
	}
	return nil
}
