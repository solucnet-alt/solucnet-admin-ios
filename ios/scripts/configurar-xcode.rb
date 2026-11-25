# Se ejecuta en el Mac de GitHub Actions antes de compilar (la gema xcodeproj viene con CocoaPods):
# agrega GoogleService-Info.plist (Firebase) a los recursos de la app y activa las notificaciones (App.entitlements).
require 'xcodeproj'
ruta = File.expand_path('../App/App.xcodeproj', __dir__)
p = Xcodeproj::Project.open(ruta)
t = p.targets.find { |x| x.name == 'App' }
grupo = p.main_group.find_subpath('App', false)
if File.exist?(File.expand_path('../App/App/GoogleService-Info.plist', __dir__)) &&
   t.resources_build_phase.files_references.none? { |f| f.path.to_s.end_with?('GoogleService-Info.plist') }
  ref = grupo.new_reference('GoogleService-Info.plist')
  t.resources_build_phase.add_file_reference(ref)
  puts 'GoogleService-Info.plist agregado'
end
t.build_configurations.each { |c| c.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'App/App.entitlements' }
p.save
puts 'Proyecto Xcode listo'
