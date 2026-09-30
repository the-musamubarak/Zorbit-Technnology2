revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.create_inventory_row() from public, anon, authenticated;
revoke execute on function public.guard_sale_update() from public, anon, authenticated;
revoke execute on function public.apply_sale_item() from public, anon, authenticated;
revoke execute on function public.restore_voided_sale() from public, anon, authenticated;
revoke execute on function public.apply_purchase_item() from public, anon, authenticated;
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
revoke execute on function public.is_admin() from public, anon;

insert into public.categories (name) values
 ('Phones'),('Back Glass'),('Screen Guards'),('Chargers'),('Power Banks'),('Cables'),('Headsets'),('Pouches');

with iphones as (
  select array['iPhone X','iPhone XR','iPhone XS','iPhone XS Max','iPhone 11','iPhone 11 Pro','iPhone 11 Pro Max','iPhone 12','iPhone 12 Mini','iPhone 12 Pro','iPhone 12 Pro Max','iPhone 13','iPhone 13 Mini','iPhone 13 Pro','iPhone 13 Pro Max','iPhone 14','iPhone 14 Plus','iPhone 14 Pro','iPhone 14 Pro Max','iPhone 15','iPhone 15 Plus','iPhone 15 Pro','iPhone 15 Pro Max','iPhone 16','iPhone 16 Plus','iPhone 16 Pro','iPhone 16 Pro Max','iPhone 17','iPhone 17 Pro','iPhone 17 Pro Max']::text[] as m
)
insert into public.category_attributes (category_id, attr_name, attr_label, input_type, options, is_required, display_order)
select c.id, v.attr_name, v.attr_label, v.input_type, v.options, v.is_required, v.display_order
from (values
 ('Phones','brand','Brand','text',null::text[],true,1),
 ('Phones','model','Model','text',null,true,2),
 ('Phones','storage','Storage','dropdown',array['64GB','128GB','256GB','512GB','1TB'],true,3),
 ('Phones','color','Color','text',null,false,4),
 ('Phones','condition','Condition','dropdown',array['New','UK Used','Refurbished'],true,5),
 ('Back Glass','compatible_model','Compatible Model','dropdown',(select m from iphones),true,1),
 ('Back Glass','finish','Color / Finish','text',null,false,2),
 ('Screen Guards','compatible_model','Compatible Model','dropdown',(select m from iphones),true,1),
 ('Screen Guards','material','Material','dropdown',array['Tempered Glass','Hydrogel','Privacy Glass'],true,2),
 ('Chargers','brand','Brand','text',null,true,1),
 ('Chargers','wattage','Wattage','dropdown',array['20W','30W','45W','65W'],true,2),
 ('Chargers','connector_type','Connector Type','dropdown',array['USB-C','Lightning','Dual Port'],true,3),
 ('Power Banks','brand','Brand','dropdown',array['Itel','Oraimo','Anker','Baseus','Romoss','Xiaomi','Infinix XPower'],true,1),
 ('Power Banks','capacity','Capacity','dropdown',array['10000mAh','20000mAh','30000mAh'],true,2),
 ('Power Banks','output_wattage','Output Wattage','dropdown',array['10W','22.5W','33W','65W'],false,3),
 ('Cables','type','Type','dropdown',array['USB-C to USB-C','USB-C to Lightning','USB-A to Lightning','USB-A to USB-C','USB-A to Micro-USB'],true,1),
 ('Cables','wattage','Wattage','dropdown',array['20W','30W','60W','100W'],false,2),
 ('Cables','length','Length','dropdown',array['1m','2m'],false,3),
 ('Headsets','type','Type','dropdown',array['Wired','Wireless','Earbuds'],true,1),
 ('Headsets','brand','Brand','text',null,false,2),
 ('Pouches','compatible_model','Compatible Model','dropdown',(select m from iphones),true,1),
 ('Pouches','material','Material','text',null,false,2),
 ('Pouches','color','Color','text',null,false,3)
) as v(cat, attr_name, attr_label, input_type, options, is_required, display_order)
join public.categories c on c.name = v.cat;
